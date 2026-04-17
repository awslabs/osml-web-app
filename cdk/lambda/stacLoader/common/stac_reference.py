#  Copyright 2025 Amazon.com, Inc. or its affiliates.
#  Copied from osml-geo-agents for consistent STAC item handling.

import datetime
import secrets
from dataclasses import dataclass
from typing import Optional

import numpy as np

STAC_PROTOCOL = "stac:"


@dataclass
class STACReference:
    """
    Represents a STAC (SpatioTemporal Asset Catalog) reference with optional collections and asset tag.

    Format: stac:<collection1>/<collection2>/.../<id>#<asset name>

    Examples:

    - stac:123ABC456D#rgb
    - stac:foo/bar/123ABC456D#rgb

    The collections and #<asset name> portions are optional.
    """

    encoded_value: str

    def __post_init__(self):
        """Validates and parses the STAC reference string after initialization."""
        if not self.encoded_value:
            raise ValueError("STAC reference cannot be empty")

        if not isinstance(self.encoded_value, str):
            raise ValueError("STAC reference must be a string")

        if not self.encoded_value.startswith(STAC_PROTOCOL):
            raise ValueError(f"STAC reference must start with '{STAC_PROTOCOL}'")

        parts = self.encoded_value.split("#", 1)

        if len(parts[0]) <= len(STAC_PROTOCOL):
            raise ValueError(f"STAC reference must include an ID after '{STAC_PROTOCOL}'")

        path_part = parts[0][len(STAC_PROTOCOL):]  # fmt: skip
        path_components = path_part.split("/")

        self._item_id = path_components[-1]
        self._collections = path_components[:-1] if len(path_components) > 1 else []
        self._asset_tag = parts[1] if len(parts) > 1 else None

        if self._asset_tag is not None and not self._asset_tag:
            raise ValueError("Asset tag cannot be empty if specified")

    @property
    def item_id(self) -> str:
        """Returns the item ID portion of the STAC reference."""
        return self._item_id

    @property
    def collections(self) -> list[str]:
        """Returns the list of collection names in the STAC reference."""
        return self._collections

    @property
    def asset_tag(self) -> Optional[str]:
        """Returns the asset tag if present, None otherwise."""
        return self._asset_tag

    @classmethod
    def new_random(cls, asset_tag: Optional[str] = None, collections: Optional[list[str]] = None) -> "STACReference":
        """Constructs a new STAC reference using a random hex ID."""
        random_id = str(secrets.token_hex(16))
        return STACReference.from_parts(random_id, asset_tag, collections)

    @classmethod
    def new_from_timestamp(
        cls,
        asset_tag: Optional[str] = None,
        prefix: Optional[str] = None,
        collections: Optional[list[str]] = None,
    ) -> "STACReference":
        """Constructs a new STAC reference using the current UTC timestamp encoded as base36."""
        current_time = datetime.datetime.now(datetime.timezone.utc)
        timestamp_int = int(current_time.timestamp() * 1000)
        base36_id = np.base_repr(timestamp_int, 36)

        if prefix:
            base36_id = f"{prefix}-{base36_id}"

        return cls.from_parts(base36_id, asset_tag, collections)

    @classmethod
    def from_parts(
        cls,
        item_id: str,
        asset_tag: Optional[str] = None,
        collections: Optional[list[str]] = None,
    ) -> "STACReference":
        """Constructs a new STAC reference from parts."""
        path_parts = []
        if collections:
            path_parts.extend(collections)
        path_parts.append(item_id)
        path = "/".join(path_parts)

        encoded_value = f"{STAC_PROTOCOL}{path}"
        if asset_tag:
            encoded_value += f"#{asset_tag}"
        return cls(encoded_value)

    def __str__(self) -> str:
        return self.encoded_value

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, STACReference):
            return NotImplemented
        return self.encoded_value == other.encoded_value
