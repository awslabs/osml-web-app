#  Copyright 2025 Amazon.com, Inc. or its affiliates.
#  Copied from osml-geo-agents for consistent STAC item handling.

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Dict, List, Optional

import geopandas as gpd
import pyarrow.parquet as pq
from pystac import Asset, Item
from s3fs import S3FileSystem

from .stac_reference import STACReference

logger = logging.getLogger(__name__)


_EXTENSION_TO_DRIVER = {
    ".bna": "BNA",
    ".dxf": "DXF",
    ".csv": "CSV",
    ".shp": "ESRI Shapefile",
    ".dbf": "ESRI Shapefile",
    ".json": "GeoJSON",
    ".geojson": "GeoJSON",
    ".geojsonl": "GeoJSONSeq",
    ".geojsons": "GeoJSONSeq",
    ".gpkg": "GPKG",
    ".gml": "GML",
    ".xml": "GML",
    ".gpx": "GPX",
    ".gtm": "GPSTrackMaker",
    ".gtz": "GPSTrackMaker",
    ".tab": "MapInfo File",
    ".mif": "MapInfo File",
    ".mid": "MapInfo File",
    ".dgn": "DGN",
    ".fgb": "FlatGeobuf",
}


class Workspace:
    """
    A workspace that manages STAC items and their assets.

    This implementation works with any fsspec-compatible filesystem, including local file systems
    and S3.
    """

    def __init__(self, filesystem, prefix: str):
        """
        Construct a new workspace.

        :param filesystem: A fsspec filesystem object (S3FileSystem, LocalFileSystem, etc.)
        :param prefix: Path prefix identifying the workspace location
        """
        self.filesystem = filesystem
        self.prefix = prefix.rstrip("/")
        self.user_id = os.path.basename(self.prefix) if self.prefix else "shared"

    def _is_s3_filesystem(self) -> bool:
        return isinstance(self.filesystem, S3FileSystem)

    def _is_local_path(self, file_path: str) -> bool:
        return file_path.startswith("/") or (not file_path.startswith("s3://"))

    def _safe_makedirs(self, dir_path: str) -> None:
        if not self._is_s3_filesystem():
            self.filesystem.makedirs(dir_path, exist_ok=True)

    def _get_stac_item_base_path(self, item_id: str, collections: Optional[List[str]] = None) -> str:
        collections_path = "/".join(filter(None, collections)) + "/" if collections else ""
        return f"{self.prefix}/stac/{collections_path}{item_id}"

    def get_item(self, stac_ref: STACReference) -> Item:
        item_base_path = self._get_stac_item_base_path(stac_ref.item_id, stac_ref.collections)
        item_path = f"{item_base_path}/item.json"
        try:
            with self.filesystem.open(item_path, "rb") as f:
                item_data = json.loads(f.read().decode("utf-8"))
                return Item.from_dict(item_data)
        except Exception as e:
            raise Exception(f"Failed to retrieve item from filesystem: {str(e)}") from e

    def list_items(self) -> List[STACReference]:
        try:
            stac_refs: List[STACReference] = []
            stac_dir = f"{self.prefix}/stac"
            try:
                if self.filesystem.exists(stac_dir):
                    dirs = self.filesystem.ls(stac_dir, detail=True)
                    dirs = [d for d in dirs if d.get("type", None) == "directory"]
                    for directory in dirs:
                        dir_path = directory["name"]
                        self._process_directory(dir_path, [], stac_refs)
            except FileNotFoundError:
                pass
            return stac_refs
        except Exception as e:
            logger.warning(f"Error listing items: {str(e)}")
            raise Exception(f"Failed to list items: {str(e)}")

    def _process_directory(self, dir_path: str, current_collections: List[str], stac_refs: List[STACReference]) -> None:
        item_json_path = f"{dir_path}/item.json"
        if self.filesystem.exists(item_json_path):
            item_id = os.path.basename(dir_path.rstrip("/"))
            stac_refs.append(STACReference.from_parts(item_id=item_id, collections=current_collections.copy()))
            return

        try:
            subdirs = self.filesystem.ls(dir_path, detail=True)
            subdirs = [d for d in subdirs if d.get("type", None) == "directory"]
            for subdir in subdirs:
                subdir_path = subdir["name"]
                subdir_name = os.path.basename(subdir_path.rstrip("/"))
                subdir_item_json_path = f"{subdir_path}/item.json"
                if self.filesystem.exists(subdir_item_json_path):
                    item_id = subdir_name
                    stac_refs.append(STACReference.from_parts(item_id=item_id, collections=current_collections.copy()))
                else:
                    new_collections = current_collections.copy()
                    new_collections.append(subdir_name)
                    self._process_directory(subdir_path, new_collections, stac_refs)
        except FileNotFoundError:
            pass
        except Exception as e:
            logger.warning(f"Error listing items: {str(e)}")
            raise Exception(f"Failed to list items: {str(e)}")

    def delete_item(self, stac_ref: STACReference) -> None:
        item_path = self._get_stac_item_base_path(stac_ref.item_id, stac_ref.collections)
        try:
            if self.filesystem.exists(item_path):
                self.filesystem.rm(item_path, recursive=True)
                logger.info(f"Deleted item {stac_ref}")
            else:
                logger.warning(f"No objects found for item {stac_ref}")
        except Exception as e:
            logger.warning(f"Error deleting item {stac_ref}: {str(e)}")
            raise Exception(f"Failed to delete item {stac_ref}: {str(e)}")

    def create_item(
        self, item: Item, temp_assets: Optional[Dict[str, Path]], collections: Optional[List[str]] = None
    ) -> STACReference:
        """
        Create an item/assets in the workspace.

        :param item: the STAC item to create
        :param temp_assets: a mapping of asset keys to local files
        :param collections: optional list of collections this item belongs to
        :return: the STAC reference for the new item
        """
        item_base_path = self._get_stac_item_base_path(item.id, collections)

        if temp_assets:
            for asset_key, local_path in temp_assets.items():
                try:
                    asset_path = f"{item_base_path}/{asset_key}/{local_path.name}"
                    self._safe_makedirs(os.path.dirname(asset_path))
                    with open(local_path, "rb") as src:
                        with self.filesystem.open(asset_path, "wb") as dst:
                            dst.write(src.read())
                    logger.info(f"Completed uploading {asset_key}")

                    if hasattr(self.filesystem, "protocol") and self.filesystem.protocol == "s3":
                        bucket = getattr(self.filesystem, "bucket_name", None)
                        if bucket:
                            asset_url = f"s3://{bucket}/{asset_path}"
                        else:
                            asset_url = asset_path
                    else:
                        asset_url = asset_path

                    item.add_asset(asset_key, Asset(href=asset_url))
                except Exception as e:
                    logger.warning(f"Error uploading {asset_key}: {str(e)}")
                    raise Exception(f"Failed to upload asset {asset_key}: {str(e)}")

        item_json_path = f"{item_base_path}/item.json"
        item_json = json.dumps(item.to_dict())
        try:
            self._safe_makedirs(os.path.dirname(item_json_path))
            with self.filesystem.open(item_json_path, "w") as f:
                f.write(item_json)
        except Exception as e:
            logger.warning(f"\nError uploading {item_json_path}: {str(e)}")
            raise Exception(f"Failed to upload item JSON: {str(e)}")

        return STACReference.from_parts(item_id=item.id, collections=collections)

    def create_item_from_bytes(
        self, item: Item, assets_bytes: Optional[Dict[str, bytes]] = None, collections: Optional[List[str]] = None
    ) -> STACReference:
        """
        Create an item/assets in the workspace, writing asset bytes directly to the filesystem.

        Unlike create_item which reads from local temp files, this method writes
        in-memory bytes directly to the target filesystem (e.g. S3), avoiding
        unnecessary temp file I/O.

        :param item: the STAC item to create
        :param assets_bytes: a mapping of asset keys to raw bytes content
        :param collections: optional list of collections this item belongs to
        :return: the STAC reference for the new item
        """
        item_base_path = self._get_stac_item_base_path(item.id, collections)

        if assets_bytes:
            for asset_key, content in assets_bytes.items():
                try:
                    asset_path = f"{item_base_path}/{asset_key}/{asset_key}.dat"
                    self._safe_makedirs(os.path.dirname(asset_path))
                    with self.filesystem.open(asset_path, "wb") as dst:
                        dst.write(content)
                    logger.info(f"Completed uploading {asset_key}")

                    if hasattr(self.filesystem, "protocol") and self.filesystem.protocol == "s3":
                        bucket = getattr(self.filesystem, "bucket_name", None)
                        if bucket:
                            asset_url = f"s3://{bucket}/{asset_path}"
                        else:
                            asset_url = asset_path
                    else:
                        asset_url = asset_path

                    item.add_asset(asset_key, Asset(href=asset_url))
                except Exception as e:
                    logger.warning(f"Error uploading {asset_key}: {str(e)}")
                    raise Exception(f"Failed to upload asset {asset_key}: {str(e)}")

        item_json_path = f"{item_base_path}/item.json"
        item_json = json.dumps(item.to_dict())
        try:
            self._safe_makedirs(os.path.dirname(item_json_path))
            with self.filesystem.open(item_json_path, "w") as f:
                f.write(item_json)
        except Exception as e:
            logger.warning(f"\nError uploading {item_json_path}: {str(e)}")
            raise Exception(f"Failed to upload item JSON: {str(e)}")

        return STACReference.from_parts(item_id=item.id, collections=collections)

    def is_parquet_file(self, file_path: str) -> bool:
        try:
            with self.filesystem.open(file_path, "rb") as f:
                magic_bytes = f.read(4)
                return magic_bytes == b"PAR1"
        except Exception:
            return False

    def read_field_descriptions_from_parquet(self, file_path: str) -> dict[str, str]:
        result = {}
        with self.filesystem.open(file_path, "rb") as f:
            schema = pq.read_table(f).schema
            for name in schema.names:
                field = schema.field(name)
                if field.metadata and b"comment" in field.metadata:
                    result[name] = field.metadata[b"comment"].decode("utf-8")
        return result

    def read_wkt_file(self, file_path: str) -> gpd.GeoDataFrame:
        try:
            if self._is_local_path(file_path):
                with open(file_path, "r") as f:
                    wkt_data = f.read()
            else:
                with self.filesystem.open(file_path, "r") as f:
                    wkt_data = f.read()
            geo_series = gpd.GeoSeries.from_wkt([wkt_data])
            gdf = gpd.GeoDataFrame(geometry=geo_series)
            gdf.set_crs(epsg=4326, inplace=True)
            return gdf
        except Exception:
            logger.error(f"Unable to create GeoDataFrame from WKT file: {os.path.basename(file_path)}", exc_info=True)
            raise ValueError(f"Unable to create GeoDataFrame from WKT file: {os.path.basename(file_path)}")

    def read_geo_data_frame(self, dataset_path: str) -> gpd.GeoDataFrame:
        try:
            if dataset_path.lower().endswith(".wkt"):
                return self.read_wkt_file(dataset_path)
            elif self.is_parquet_file(dataset_path):
                with self.filesystem.open(dataset_path, "rb") as f:
                    gdf = gpd.read_parquet(f)
                gdf.attrs["column-descriptions"] = self.read_field_descriptions_from_parquet(dataset_path)
            else:
                _, ext = os.path.splitext(dataset_path.lower())
                driver = _EXTENSION_TO_DRIVER.get(ext)
                with tempfile.NamedTemporaryFile(suffix=ext) as temp_file:
                    with self.filesystem.open(dataset_path, "rb") as f:
                        temp_file.write(f.read())
                        temp_file.flush()
                    gdf = gpd.read_file(temp_file.name, driver=driver)

            if gdf is None:
                raise ValueError(f"Unable to create GeoDataFrame from: {os.path.basename(dataset_path)}")
            return gdf
        except Exception:
            logger.error(f"Unable to create GeoDataFrame from: {os.path.basename(dataset_path)}", exc_info=True)
            raise ValueError(f"Unable to create GeoDataFrame from: {os.path.basename(dataset_path)}")

    def write_geo_data_frame(self, dataset_path: str, dataset_gdf: gpd.GeoDataFrame) -> None:
        self._safe_makedirs(os.path.dirname(dataset_path))
        is_temp_file = str(dataset_path).startswith(tempfile.gettempdir())

        if dataset_path.lower().endswith((".parquet", ".geoparquet")):
            if is_temp_file:
                dataset_gdf.to_parquet(dataset_path)
            else:
                dataset_gdf.to_parquet(dataset_path, filesystem=self.filesystem)
        else:
            _, ext = os.path.splitext(dataset_path.lower())
            driver = _EXTENSION_TO_DRIVER.get(ext)
            is_geojson = ext.lower() in [".json", ".geojson"]
            write_gdf = dataset_gdf

            if is_geojson:
                write_gdf = self.combine_geometry_columns(dataset_gdf)

            if is_temp_file:
                write_gdf.to_file(dataset_path, driver=driver)
            else:
                with tempfile.NamedTemporaryFile(suffix=ext) as temp_file:
                    write_gdf.to_file(temp_file.name, driver=driver)
                    with open(temp_file.name, "rb") as src:
                        with self.filesystem.open(dataset_path, "wb") as dst:
                            dst.write(src.read())

    def combine_geometry_columns(self, gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
        geometry_cols = gdf.columns[gdf.dtypes == "geometry"]
        if len(geometry_cols) <= 1:
            return gdf

        result_gdf = gdf.copy()
        active_geom_col = gdf.geometry.name

        from shapely.geometry import GeometryCollection

        def flatten_geometry_collection(geom):
            if geom is None:
                return []
            if isinstance(geom, GeometryCollection):
                flattened = []
                for g in geom.geoms:
                    flattened.extend(flatten_geometry_collection(g))
                return flattened
            else:
                return [geom]

        def combine_geometries(row):
            all_geometries = []
            for col in geometry_cols:
                if row[col] is not None:
                    all_geometries.extend(flatten_geometry_collection(row[col]))
            return GeometryCollection(all_geometries) if all_geometries else None

        result_gdf[active_geom_col] = result_gdf.apply(combine_geometries, axis=1)
        cols_to_drop = [col for col in geometry_cols if col != active_geom_col]
        if cols_to_drop:
            result_gdf = result_gdf.drop(columns=cols_to_drop)
        return result_gdf
