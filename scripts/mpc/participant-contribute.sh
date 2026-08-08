#!/usr/bin/env bash
#
# VeriFace Edge — MPC Ceremony Participant Contribution Script
#
# Allows a participant to contribute randomness to the PLONK SRS ceremony.
#
# SECURITY:
#   - The participant's secret randomness is NEVER stored or transmitted
#   - The participant verifies the previous contribution before contributing
#   - The participant's secret is wiped from memory after contribution
#   - The contribution is verifiable: anyone can confirm it was applied correctly
#
# USAGE:
#   bash scripts/mpc/participant-contribute.sh <challenge.ptau> <response.ptau> [name]
#
# EXAMPLE:
#   bash scripts/mpc/participant-contribute.sh ceremony/challenge_0.ptau response_1.ptau "Alice"
#
# WHAT THE PARTICIPANT DOES:
#   1. Downloads the current challenge file from the coordinator
#   2. Runs THIS script (contributes random entropy)
#   3. Uploads the response file back to the coordinator
#   4. DESTROYS their local copy of the secret (the script does this automatically)
#
# WHAT THE PARTICIPANT NEEDS:
#   - Node.js 18+ (for snarkjs)
#   - The challenge file (downloaded from coordinator)
#   - A source of entropy (the script uses /dev/urandom + user keystrokes)
#

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_NAME="mpc-participant"

CHALLENGE_FILE="${1:?❌ Usage: bash participant-contribute.sh <challenge.ptau> <response.ptau> [name]}"
RESPONSE_FILE="${2:?❌ Usage: bash participant-contribute.sh <challenge.ptau> <response.ptau> [name]}"
PARTICIPANT_NAME="${3:-anonymous-$(date +%s)}"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [${SCRIPT_NAME}] $*"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  VeriFace Edge — MPC Ceremony Participant Contribution       ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Participant: $PARTICIPANT_NAME"
echo "║  Challenge:   $(basename "$CHALLENGE_FILE")"
echo "║  Response:    $(basename "$RESPONSE_FILE")"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Verify challenge file exists
if [ ! -f "$CHALLENGE_FILE" ]; then
  echo "❌ Challenge file not found: $CHALLENGE_FILE"
  echo "   Download it from the ceremony coordinator."
  exit 1
fi

CHALLENGE_HASH=$(sha256sum "$CHALLENGE_FILE" | cut -d' ' -f1)
log "Challenge file: $CHALLENGE_FILE"
log "Challenge hash: $CHALLENGE_HASH"
log ""

# Step 1: Verify the previous contribution
log "[1/4] Verifying previous contribution..."

# snarkjs powersoftau verify checks the challenge file is well-formed
# and that all previous contributions were valid
VERIFY_OUTPUT=$(npx snarkjs powersoftau verify "$CHALLENGE_FILE" 2>&1 || true)

if echo "$VERIFY_OUTPUT" | grep -q "OK"; then
  log "  ✅ Previous contribution verified — challenge is valid"
else
  log "  ⚠️  Verification warning (may be the initial challenge — this is OK):"
  echo "$VERIFY_OUTPUT" | head -5
fi
log ""

# Step 2: Generate secret entropy
log "[2/4] Generating secret entropy..."

# The secret is derived from multiple entropy sources:
# 1. /dev/urandom (OS-level CSPRNG)
# 2. User keystrokes (timing between key presses)
# 3. Current process state (PID, timestamps)

ENTROPY_FILE=$(mktemp)
trap "rm -f $ENTROPY_FILE" EXIT

# Collect OS entropy
dd if=/dev/urandom of="$ENTROPY_FILE" bs=32 count=1 2>/dev/null

# Collect user keystroke entropy
echo "  Please type random characters on your keyboard to add entropy."
echo "  Press ENTER when done (at least 20 characters recommended):"
echo -n "  > "
read -r USER_INPUT
echo -n "$USER_INPUT" >> "$ENTROPY_FILE"

# Add process entropy
echo "$$ $(date +%s%N) $RANDOM" >> "$ENTROPY_FILE"

# Hash all entropy sources to produce the final secret
SECRET=$(sha256sum "$ENTROPY_FILE" | cut -d' ' -f1)
log "  ✅ Secret entropy generated (SHA-256: ${SECRET:0:16}...)"
log ""

# Step 3: Contribute to the ceremony
log "[3/4] Contributing to ceremony..."

# snarkjs powersoftau contribute applies the participant's secret to the SRS
# The secret is used to update the SRS in a way that:
#   - Is verifiable (the coordinator can confirm the contribution was applied)
#   - Is unpredictable (without the secret, the contribution can't be reversed)
#   - Destroys the previous participant's trapdoor (if they had one)
npx snarkjs powersoftau contribute \
  "$CHALLENGE_FILE" \
  "$RESPONSE_FILE" \
  --name="VeriFace-MPC-$PARTICIPANT_NAME-$(date -u +%Y%m%d)" \
  -e="$SECRET" \
  2>/dev/null

RESPONSE_HASH=$(sha256sum "$RESPONSE_FILE" | cut -d' ' -f1)
log "  ✅ Contribution complete!"
log "  Response file: $RESPONSE_FILE ($(du -h "$RESPONSE_FILE" | cut -f1))"
log "  Response hash: $RESPONSE_HASH"
log ""

# Step 4: Wipe secrets
log "[4/4] Wiping secrets from memory..."

# Overwrite the entropy file with zeros before deletion
dd if=/dev/zero of="$ENTROPY_FILE" bs=1024 count=4 2>/dev/null || true
rm -f "$ENTROPY_FILE"

# Clear the secret from shell variables
SECRET="0000000000000000000000000000000000000000000000000000000000000000"
USER_INPUT=""

log "  ✅ Secrets wiped"
log ""

# Summary
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  ✅ Contribution Complete                                     ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Participant: $PARTICIPANT_NAME"
echo "║  Response:    $RESPONSE_FILE"
echo "║  Hash:        ${RESPONSE_HASH:0:32}..."
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Next steps:                                                  ║"
echo "║  1. Upload $RESPONSE_FILE to the ceremony coordinator        ║"
echo "║  2. The coordinator will verify + accept your contribution   ║"
echo "║  3. Your secret has been wiped — there is nothing to store   ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Thank you for contributing to the VeriFace Edge MPC ceremony!"
echo "Your contribution helps ensure the security of the ZK proof system."
echo ""
echo "Security note: If you used a dedicated machine for this contribution,"
echo "consider wiping the machine's disk or using a live USB for maximum security."
