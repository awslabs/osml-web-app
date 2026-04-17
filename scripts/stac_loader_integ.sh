#!/bin/bash
#
# Copyright 2025 Amazon.com, Inc. or its affiliates.
#
# Invokes the STAC Loader integration test Lambda and streams results
# from CloudWatch Logs. Follows the same pattern as geo_agents_integ.sh.
#
# Usage:
#   ./scripts/stac_loader_integ.sh                          # uses defaults
#   ./scripts/stac_loader_integ.sh --project-name MyProject # custom project name
#

set -e
set -o pipefail

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
PROJECT_NAME="${PROJECT_NAME:-OSML-WebApp}"

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --project-name)
            PROJECT_NAME="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--project-name NAME]"
            exit 1
            ;;
    esac
done

FUNCTION_NAME="${PROJECT_NAME}-StacLoaderIntegrationTest"
LOG_GROUP="/aws/lambda/${FUNCTION_NAME}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
print_banner() {
    echo "=========================================="
    echo " Running STAC Loader Integration Tests   "
    echo "=========================================="
}

print_test_passed() {
    echo "=========================================="
    echo "      Integration Tests Completed        "
    echo "=========================================="
    echo "           All tests passed!             "
    echo "=========================================="
}

print_test_failed() {
    echo "=========================================="
    echo "       Integration Tests Failed          "
    echo "=========================================="
    echo "       Some tests did not pass!          "
    echo "=========================================="
}

handle_error() {
    echo "ERROR: An error occurred during the script execution."
    exit 1
}

trap 'handle_error' ERR

# ---------------------------------------------------------------------------
# Resolve AWS region
# ---------------------------------------------------------------------------
if [ -z "$AWS_REGION" ]; then
    {
        AWS_REGION=$(aws configure get region)
    } || {
        if [ -n "$AWS_DEFAULT_REGION" ]; then
            AWS_REGION=$AWS_DEFAULT_REGION
        else
            read -p "Could not find region. Enter the AWS region (ex. us-west-2): " user_region
            if [ -n "$user_region" ]; then
                AWS_REGION=$user_region
            else
                echo "ERROR: AWS region is required."
                exit 1
            fi
        fi
    }
fi

# ---------------------------------------------------------------------------
# Resolve AWS account (informational)
# ---------------------------------------------------------------------------
ACCOUNT_ID=$(aws sts get-caller-identity --region "$AWS_REGION" --query Account --output text)

if [ -z "$ACCOUNT_ID" ]; then
    read -p "Please enter your AWS Account ID: " account_id
    if [ -z "$account_id" ]; then
        echo "ERROR: AWS Account ID is required."
        exit 1
    else
        ACCOUNT_ID=$account_id
    fi
fi

# ---------------------------------------------------------------------------
# Invoke Lambda
# ---------------------------------------------------------------------------
print_banner

echo "Function:  $FUNCTION_NAME"
echo "Region:    $AWS_REGION"
echo "Account:   $ACCOUNT_ID"
echo ""

TEMP_PAYLOAD=$(mktemp)
echo "{}" > "$TEMP_PAYLOAD"

RESPONSE_FILE=$(mktemp)
if ! aws lambda invoke --region "$AWS_REGION" \
                       --function-name "$FUNCTION_NAME" \
                       --payload fileb://"$TEMP_PAYLOAD" \
                       --cli-read-timeout 0 \
                       "$RESPONSE_FILE" > /dev/null 2>&1; then
    echo "ERROR: Failed to invoke Lambda function '$FUNCTION_NAME'"
    rm -f "$TEMP_PAYLOAD" "$RESPONSE_FILE"
    exit 1
fi

echo "Lambda invoked successfully, retrieving logs from CloudWatch..."
echo ""

# ---------------------------------------------------------------------------
# Retrieve CloudWatch logs
# ---------------------------------------------------------------------------
# Disable strict error handling for the log-polling section
trap - ERR
set +e
set +o pipefail

echo "Waiting for CloudWatch logs to propagate..."
sleep 10

LOG_STREAMS_LIST=$(aws logs describe-log-streams \
    --region "$AWS_REGION" \
    --log-group-name "$LOG_GROUP" \
    --order-by LastEventTime \
    --descending \
    --max-items 3 \
    --output json 2>&1)
DESCRIBE_EXIT=$?

if [ $DESCRIBE_EXIT -ne 0 ]; then
    echo "ERROR: Failed to describe log streams for $LOG_GROUP"
    echo "$LOG_STREAMS_LIST"
    rm -f "$TEMP_PAYLOAD" "$RESPONSE_FILE"
    exit 1
fi

LOG_STREAM=$(echo "$LOG_STREAMS_LIST" | jq -r '.logStreams[0].logStreamName' 2>&1)

if [ -z "$LOG_STREAM" ] || [ "$LOG_STREAM" == "null" ] || [ "$LOG_STREAM" == "None" ]; then
    echo "ERROR: Could not find log stream for $LOG_GROUP"
    echo "Available log streams:"
    echo "$LOG_STREAMS_LIST" | jq -r '.logStreams[].logStreamName' 2>&1
    rm -f "$TEMP_PAYLOAD" "$RESPONSE_FILE"
    exit 1
fi

echo "Using log stream: $LOG_STREAM"

# Poll until logs are complete (contains END RequestId)
MAX_ATTEMPTS=18
ATTEMPT=0
decoded_log=""
log_events_json=""

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    ATTEMPT=$((ATTEMPT + 1))

    log_events_json=$(aws logs get-log-events \
        --region "$AWS_REGION" \
        --log-group-name "$LOG_GROUP" \
        --log-stream-name "$LOG_STREAM" \
        --start-from-head \
        --output json 2>&1)

    if [ $? -eq 0 ]; then
        decoded_log=$(echo "$log_events_json" | jq -r '.events[].message')

        if echo "$decoded_log" | grep -q "END RequestId:"; then
            echo "Logs retrieved successfully."
            break
        fi
    fi

    if [ $ATTEMPT -lt $MAX_ATTEMPTS ]; then
        echo "Waiting for complete logs... (attempt $ATTEMPT/$MAX_ATTEMPTS)"
        sleep 5
    fi
done

if [ -z "$decoded_log" ] || ! echo "$decoded_log" | grep -q "END RequestId:"; then
    echo "ERROR: Could not retrieve complete logs from CloudWatch"
    rm -f "$TEMP_PAYLOAD" "$RESPONSE_FILE"
    exit 1
fi

rm -f "$RESPONSE_FILE"

# ---------------------------------------------------------------------------
# Parse results
# ---------------------------------------------------------------------------

# Extract the test summary line (e.g. "Tests: 12, Passed: 12, ...")
test_summary=$(echo "$log_events_json" | jq -r '.events[] | select(.message | contains("Tests:")) | .message' | while read -r line; do
    inner_msg=$(echo "$line" | jq -r '.message' 2>/dev/null || echo "$line")
    echo "$inner_msg"
done | head -1)

rm -f "$TEMP_PAYLOAD"

# Check for 100% success
if echo "$decoded_log" | grep -q "Success: 100.00%"; then
    echo "$test_summary"
    echo ""
    print_test_passed
    exit 0
else
    print_test_failed
    echo ""
    echo "$test_summary"
    echo ""

    # Extract pytest short test summary
    pytest_summary=$(echo "$decoded_log" | awk '
        /short test summary info/ {p=1; print; next}
        p==1 && /(failed|passed) in [0-9]+\.[0-9]+s/ {print; exit}
        p==1 {print}
    ')

    if [ -n "$pytest_summary" ]; then
        echo "$pytest_summary"
    else
        echo "Could not extract test failure details from logs."
    fi

    exit 1
fi
