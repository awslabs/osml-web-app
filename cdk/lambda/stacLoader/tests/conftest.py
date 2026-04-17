#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""Common test fixtures for the STAC Data Loader tests."""

import pytest
from common.workspace import Workspace
from fsspec.implementations.local import LocalFileSystem
from pystac import Item
from shapely.geometry import Point


@pytest.fixture
def tmp_workspace_dir(tmp_path):
    """Provide a temporary directory for workspace storage."""
    return tmp_path


@pytest.fixture
def local_filesystem():
    """Provide a local filesystem instance for testing."""
    return LocalFileSystem()


@pytest.fixture
def workspace(local_filesystem, tmp_workspace_dir):
    """Provide a Workspace instance backed by a local filesystem."""
    return Workspace(filesystem=local_filesystem, prefix=str(tmp_workspace_dir))


@pytest.fixture
def sample_stac_item():
    """Create a minimal valid STAC item for testing."""
    return Item(
        id="test-item-001",
        geometry=Point(0, 0).__geo_interface__,
        bbox=[-1, -1, 1, 1],
        datetime=None,
        properties={"datetime": None, "test_property": "test_value"},
    )
