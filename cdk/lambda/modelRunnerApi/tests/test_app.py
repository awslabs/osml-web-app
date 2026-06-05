# Copyright Amazon.com, Inc. or its affiliates.
"""Tests for the Model Runner API /jobs list endpoint scan pagination."""

import asyncio


def _item(job_id, **extra):
    item = {
        "job_id": job_id,
        "job_name": "job",
        "status": "SUCCESS",
        "updated_at": "2025-01-01T00:00:00",
        "image_status": "SUCCESS",
        "image_id": "img",
        "processing_duration": "0",
        "output_bucket": "bucket",
    }
    item.update(extra)
    return item


def _list_jobs(app_module):
    return asyncio.run(app_module.list_image_processing_jobs())


def test_list_jobs_empty(mr_app):
    app_module, _table = mr_app
    assert _list_jobs(app_module).jobs == []


def test_list_jobs_returns_all_items(mr_app):
    app_module, table = mr_app
    for i in range(5):
        table.put_item(Item=_item(f"job-{i}"))

    result = _list_jobs(app_module)
    assert {j.job_id for j in result.jobs} == {f"job-{i}" for i in range(5)}


def test_list_jobs_follows_pagination(mr_app, monkeypatch):
    """The endpoint must follow LastEvaluatedKey across scan pages."""
    app_module, _table = mr_app

    pages = [
        {"Items": [_item("a")], "LastEvaluatedKey": {"job_id": "a"}},
        {"Items": [_item("b")], "LastEvaluatedKey": {"job_id": "b"}},
        {"Items": [_item("c")]},
    ]
    start_keys = []

    class _FakeTable:
        def scan(self, **kwargs):
            start_keys.append(kwargs.get("ExclusiveStartKey"))
            return pages[len(start_keys) - 1]

    monkeypatch.setattr(app_module, "table", _FakeTable())

    result = _list_jobs(app_module)
    assert [j.job_id for j in result.jobs] == ["a", "b", "c"]
    # First call has no start key; later calls follow the prior LastEvaluatedKey.
    assert start_keys == [None, {"job_id": "a"}, {"job_id": "b"}]


def test_list_jobs_large_dataset_paginates(mr_app):
    """A moto-backed scan that spans multiple 1MB pages returns every item."""
    app_module, table = mr_app
    pad = "x" * 4000  # ~4 KB per item so the table exceeds one 1MB scan page
    n = 400
    with table.batch_writer() as batch:
        for i in range(n):
            batch.put_item(Item=_item(f"job-{i:04d}", pad=pad))

    result = _list_jobs(app_module)
    assert len(result.jobs) == n
