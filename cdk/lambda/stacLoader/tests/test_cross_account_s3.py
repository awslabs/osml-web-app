#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""Unit tests for cross-account S3 access with mocked STS.

Requirements: 11A.1, 11A.2, 11A.3, 11A.4, 11A.5
"""

import asyncio
from unittest.mock import MagicMock, patch

from fetcher import STACFetcher

VALID_ROLE_ARN = "arn:aws:iam::123456789012:role/TestCrossAccountRole"
FAKE_CREDENTIALS = {
    "AccessKeyId": "ASIAIOSFODNN7EXAMPLE",
    "SecretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    "SessionToken": "FwoGZXIvYXdzEBYaDH...",
}


def test_assume_role_returns_credentials():
    """Verify _assume_role calls STS and returns temporary credentials (11A.1)."""

    async def run():
        async with STACFetcher(assume_role_arn=VALID_ROLE_ARN) as fetcher:
            mock_sts = MagicMock()
            mock_sts.assume_role.return_value = {"Credentials": FAKE_CREDENTIALS}

            with patch("fetcher.boto3.client", return_value=mock_sts) as mock_client:
                creds = await fetcher._assume_role(VALID_ROLE_ARN)

            mock_client.assert_called_once_with("sts")
            mock_sts.assume_role.assert_called_once_with(
                RoleArn=VALID_ROLE_ARN,
                RoleSessionName="stac-fetcher-session",
            )
            assert creds["AccessKeyId"] == FAKE_CREDENTIALS["AccessKeyId"]
            assert creds["SecretAccessKey"] == FAKE_CREDENTIALS["SecretAccessKey"]
            assert creds["SessionToken"] == FAKE_CREDENTIALS["SessionToken"]

    asyncio.run(run())
