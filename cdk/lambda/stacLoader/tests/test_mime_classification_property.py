#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""
Property 6: Text MIME type classification

For any asset with MIME type matching text/*, application/json, application/xml,
or application/geo+json, the asset should be classified as text-based.

**Validates: Requirements 3.3**

Property 7: Image MIME type classification

For any asset with MIME type matching image/*, the asset should be classified
as image-based.

**Validates: Requirements 3.4**

Property 8: File extension type inference

For any asset without a MIME type, the asset type should be inferred from its
file extension (.txt, .json, .xml, .geojson → text; .jpg, .jpeg, .png, .tif,
.tiff → image).

**Validates: Requirements 3.5**
"""

from fetcher import classify_mime_type, infer_type_from_extension
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

# --- Strategies ---

# Generate text/* subtypes
text_subtypes = st.from_regex(r"[a-z]{1,10}", fullmatch=True)
text_star_mimes = text_subtypes.map(lambda s: f"text/{s}")

# The exact text MIME types
text_exact_mimes = st.sampled_from(["application/json", "application/xml", "application/geo+json"])

# All text MIME types combined
text_mimes = st.one_of(text_star_mimes, text_exact_mimes)

# Generate image/* subtypes
image_subtypes = st.from_regex(r"[a-z]{1,10}", fullmatch=True)
image_mimes = image_subtypes.map(lambda s: f"image/{s}")

# Text file extensions
text_extensions = st.sampled_from([".txt", ".json", ".xml", ".geojson"])

# Image file extensions
image_extensions = st.sampled_from([".jpg", ".jpeg", ".png", ".tif", ".tiff"])

# Random filename stems
filename_stems = st.from_regex(r"[a-z0-9_]{1,20}", fullmatch=True)


# --- Property 6: Text MIME type classification ---
# Feature: stac-loader-enhancements, Property 6: Text MIME type classification


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(mime=text_mimes)
def test_text_mime_classified_as_text(mime):
    """Any text-based MIME type must be classified as 'text'."""
    assert classify_mime_type(mime) == "text"


# --- Property 7: Image MIME type classification ---
# Feature: stac-loader-enhancements, Property 7: Image MIME type classification


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(mime=image_mimes)
def test_image_mime_classified_as_image(mime):
    """Any image/* MIME type must be classified as 'image'."""
    assert classify_mime_type(mime) == "image"


# --- Property 8: File extension type inference ---
# Feature: stac-loader-enhancements, Property 8: File extension type inference


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(stem=filename_stems, ext=text_extensions)
def test_text_extension_inferred_as_text(stem, ext):
    """Files with text extensions must be inferred as 'text'."""
    path = f"/some/path/{stem}{ext}"
    assert infer_type_from_extension(path) == "text"


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(stem=filename_stems, ext=image_extensions)
def test_image_extension_inferred_as_image(stem, ext):
    """Files with image extensions must be inferred as 'image'."""
    path = f"/some/path/{stem}{ext}"
    assert infer_type_from_extension(path) == "image"
