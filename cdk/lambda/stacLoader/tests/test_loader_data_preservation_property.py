#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""
Property 4: Data Preservation

For any STAC item loaded into the workspace, the loaded item SHALL preserve
all original properties and asset key mappings from the source item.

**Validates: Requirements 2.2, 2.5**
"""

import tempfile
from datetime import datetime, timezone

from common.workspace import Workspace
from fetcher import FetchResult
from fsspec.implementations.local import LocalFileSystem
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from loader import STACLoader
from pystac import Item
from shapely.geometry import Point

# Strategy: generate random property keys (alphanumeric, reasonable length)
property_keys = st.text(
    alphabet=st.characters(whitelist_categories=("Ll", "Lu", "Nd"), whitelist_characters="_"),
    min_size=1,
    max_size=20,
).filter(lambda s: s[0].isalpha())

# Strategy: generate random property values (strings, ints, floats, bools)
property_values = st.one_of(
    st.text(min_size=0, max_size=50),
    st.integers(min_value=-1000000, max_value=1000000),
    st.floats(allow_nan=False, allow_infinity=False, min_value=-1e6, max_value=1e6),
    st.booleans(),
)

# Strategy: generate random properties dict
random_properties = st.dictionaries(
    keys=property_keys,
    values=property_values,
    min_size=0,
    max_size=10,
)

# Strategy: generate random item IDs
item_ids = st.text(
    alphabet=st.characters(whitelist_categories=("Ll", "Lu", "Nd"), whitelist_characters="-_"),
    min_size=1,
    max_size=30,
).filter(lambda s: s[0].isalnum())

# Strategy: generate random asset keys
asset_keys = st.text(
    alphabet=st.characters(whitelist_categories=("Ll", "Lu", "Nd"), whitelist_characters="_"),
    min_size=1,
    max_size=15,
).filter(lambda s: s[0].isalpha())

# Strategy: generate random asset content (small binary data)
asset_content = st.binary(min_size=1, max_size=100)

# Strategy: generate random assets dict
random_assets = st.dictionaries(
    keys=asset_keys,
    values=asset_content,
    min_size=0,
    max_size=3,
)


def create_workspace():
    """Create a fresh workspace for each test iteration."""
    tmp_dir = tempfile.mkdtemp()
    filesystem = LocalFileSystem()
    return Workspace(filesystem=filesystem, prefix=tmp_dir)


def create_stac_item(item_id: str, properties: dict) -> Item:
    """Create a STAC item with the given ID and properties."""
    return Item(
        id=item_id,
        geometry=Point(0, 0).__geo_interface__,
        bbox=[-1, -1, 1, 1],
        datetime=datetime.now(timezone.utc),
        properties=properties.copy(),
    )


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(
    item_id=item_ids,
    properties=random_properties,
    assets=random_assets,
)
def test_data_preservation(item_id, properties, assets):
    """
    Property: Loading a STAC item preserves all original properties and asset keys.

    For any randomly generated STAC item with properties and assets:
    1. Load the item into the workspace
    2. Retrieve the item using the returned STACReference
    3. Verify all original properties are preserved
    4. Verify all asset keys are present in the loaded item
    """
    # Create fresh workspace for this iteration
    workspace = create_workspace()

    # Create the STAC item
    item = create_stac_item(item_id, properties)
    source_url = f"http://test.example.com/items/{item_id}"

    # Create FetchResult
    fetch_result = FetchResult(
        item=item,
        source_url=source_url,
        assets_fetched=assets,
    )

    # Load into workspace
    loader = STACLoader(workspace)
    load_result = loader.load_item(fetch_result)

    # Retrieve the item
    retrieved_item = workspace.get_item(load_result.stac_reference)

    # Verify properties are preserved
    for key, value in properties.items():
        assert key in retrieved_item.properties, f"Property '{key}' missing from loaded item"
        # Handle float comparison with tolerance
        if isinstance(value, float):
            assert (
                abs(retrieved_item.properties[key] - value) < 1e-9
            ), f"Property '{key}' value mismatch: expected {value}, got {retrieved_item.properties[key]}"
        else:
            assert (
                retrieved_item.properties[key] == value
            ), f"Property '{key}' value mismatch: expected {value}, got {retrieved_item.properties[key]}"

    # Verify asset keys are preserved (if any assets were provided)
    for asset_key in assets.keys():
        assert asset_key in retrieved_item.assets, f"Asset key '{asset_key}' missing from loaded item"

    # Verify item ID is preserved
    assert retrieved_item.id == item_id, f"Item ID mismatch: expected {item_id}, got {retrieved_item.id}"
