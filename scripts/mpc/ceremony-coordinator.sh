#!/usr/bin/env bash
#
# VeriFace Edge — MPC Ceremony Coordinator
#
# Coordinates a multi-party computation (MPC) ceremony for the PLONK
# universal SRS (Structured Reference String) using the Perpetual Powers
# of Tau protocol.
#
# SECURITY MODEL:
#   - Each participant contributes random entropy to the SRS
#   - Each contribution is verified by the next participant before they contribute
#   - After N participants, the SRS is secure if AT LEAST ONE was honest
#   - The coordinator NEVER sees any participant's secret randomness
#   - The ceremony transcript is published for public audit
#
# PROTOCOL (Perpetual Powers of Tau):
#   1. Coordinator generates the initial ceremony file (challenge_0.ptau)
#   2. Participant 1 downloads challenge_0.ptau
#   3. Participant 1 runs: contribute.sh → produces response_1.ptau
#   4. Coordinator verifies response_1.ptau → promotes to challenge_1.ptau
#   5. Participant 2 downloads challenge_1.ptau → produces response_2.ptau
#   6. ... repeat for all participants ...
#   7. Final SRS = last verified response → final.ptau
#   8. Transcript published (all contributions + verification hashes)
#
# USAGE:
#   # Initialize ceremony (coordinator)
#   bash scripts/mpc/ceremony-coordinator.sh init
#
#   # List pending contributions
#   bash scripts/mpc/ceremony-coordinator.sh status
#
#   # Verify + accept a participant's contribution
#   bash scripts/mpc/ceremony-coordinator.sh accept response_3.ptau "Alice <alice@example.com>"
#
#   # Finalize ceremony (after all contributions)
#   bash scripts/mpc/ceremony-coordinator.sh finalize
#
#   # Generate public transcript
#   bash scripts/mpc/ceremony-coordinator.sh transcript
#
# ENVIRONMENT:
#   MPC_CEREMONY_DIR — Directory for ceremony files (default: ./ceremony)
#   MPC_PTAU_POWER   — Power of 2 for SRS size (default: 20 = 2^20 = 1M constraints)
#   MPC_MIN_PARTICIPANTS — Minimum participants (default: 10)
#

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CEREMONY_DIR="${MPC_CEREMONY_DIR:-./ceremony}"
PTAU_POWER="${MPC_PTAU_POWER:-20}"
MIN_PARTICIPANTS="${MPC_MIN_PARTICIPANTS:-10}"
CEREMONY_LOG="${CEREMONY_DIR}/ceremony.log"
TRANSCRIPT_FILE="${CEREMONY_DIR}/TRANSCRIPT.md"
STATE_FILE="${CEREMONY_DIR}/state.json"

SCRIPT_NAME="mpc-coordinator"

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [${SCRIPT_NAME}] $*"
  echo "$msg"
  echo "$msg" >> "$CEREMONY_LOG"
}

error() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [${SCRIPT_NAME}] ❌ $*"
  echo "$msg" >&2
  echo "$msg" >> "$CEREMONY_LOG"
}

# ---------------------------------------------------------------------------
# State management
# ---------------------------------------------------------------------------

init_state() {
  if [ ! -f "$STATE_FILE" ]; then
    cat > "$STATE_FILE" << 'EOF'
{
  "status": "not_initialized",
  "participants": [],
  "currentRound": 0,
  "totalRounds": 0,
  "startedAt": null,
  "finalizedAt": null,
  "finalSrsHash": null
}
EOF
  fi
}

read_state() {
  python3 -c "import json; print(json.dumps(json.load(open('$STATE_FILE'))))"
}

update_state() {
  local key="$1"
  local value="$2"
  python3 -c "
import json
with open('$STATE_FILE', 'r') as f:
    state = json.load(f)
state['$key'] = $value
with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
"
}

add_participant() {
  local name="$1"
  local response_file="$2"
  local hash="$3"
  python3 -c "
import json
with open('$STATE_FILE', 'r') as f:
    state = json.load(f)
state['participants'].append({
    'name': '$name',
    'responseFile': '$response_file',
    'hash': '$hash',
    'timestamp': '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
})
state['currentRound'] = state['currentRound'] + 1
with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
"
}

# ---------------------------------------------------------------------------
# Command: init
# ---------------------------------------------------------------------------

cmd_init() {
  log "=== Initializing MPC Ceremony ==="
  log "Ceremony directory: $CEREMONY_DIR"
  log "SRS power: 2^$PTAU_POWER (${PTAU_POWER})"
  log "Min participants: $MIN_PARTICIPANTS"

  mkdir -p "$CEREMONY_DIR"

  init_state

  # Generate the initial challenge (challenge_0.ptau)
  # This is the "powers of tau" ceremony start
  # snarkjs uses the beacon approach for the initial challenge
  INITIAL_CHALLENGE="${CEREMONY_DIR}/challenge_0.ptau"

  if [ -f "$INITIAL_CHALLENGE" ]; then
    log "Initial challenge already exists: $INITIAL_CHALLENGE"
  else
    log "Generating initial challenge (powers of tau)..."
    # Use a random beacon for the initial challenge
    # The beacon is public — security comes from participant contributions, not this beacon
    BEACON=$(openssl rand -hex 32)
    npx snarkjs powersoftau new "$PTAU_POWER" "$INITIAL_CHALLENGE" 2>/dev/null
    log "Initial challenge generated: $INITIAL_CHALLENGE"
    log "Initial hash: $(sha256sum "$INITIAL_CHALLENGE" | cut -d' ' -f1)"
  fi

  # Update state
  update_state "status" '"in_progress"'
  update_state "startedAt" "\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
  update_state "totalRounds" "$MIN_PARTICIPANTS"

  log ""
  log "Ceremony initialized. Next steps:"
  log "  1. Share the initial challenge with participant 1:"
  log "     File: $INITIAL_CHALLENGE"
  log "  2. Participant 1 runs: bash scripts/mpc/participant-contribute.sh"
  log "  3. Coordinator accepts: bash scripts/mpc/ceremony-coordinator.sh accept response_1.ptau 'Alice'"
  log ""
  log "Current challenge for participants: $INITIAL_CHALLENGE"
}

# ---------------------------------------------------------------------------
# Command: status
# ---------------------------------------------------------------------------

cmd_status() {
  log "=== MPC Ceremony Status ==="
  STATE=$(read_state)
  echo "$STATE" | python3 -m json.tool

  CURRENT_ROUND=$(echo "$STATE" | python3 -c "import json,sys; print(json.load(sys.stdin)['currentRound'])")
  TOTAL_ROUNDS=$(echo "$STATE" | python3 -c "import json,sys; print(json.load(sys.stdin)['totalRounds'])")
  STATUS=$(echo "$STATE" | python3 -c "import json,sys; print(json.load(sys.stdin)['status'])")

  echo ""
  echo "Participants: $CURRENT_ROUND / $TOTAL_ROUNDS"
  echo "Status: $STATUS"

  if [ "$CURRENT_ROUND" -lt "$TOTAL_ROUNDS" ]; then
    CURRENT_CHALLENGE="${CEREMONY_DIR}/challenge_${CURRENT_ROUND}.ptau"
    echo "Current challenge file: $CURRENT_CHALLENGE"
    echo ""
    echo "Next participant should:"
    echo "  1. Download: $CURRENT_CHALLENGE"
    echo "  2. Run: bash scripts/mpc/participant-contribute.sh $CURRENT_CHALLENGE response.ptau"
    echo "  3. Submit response.ptau to coordinator"
  elif [ "$STATUS" = "in_progress" ]; then
    echo ""
    echo "✅ All $TOTAL_ROUNDS contributions received!"
    echo "Run: bash scripts/mpc/ceremony-coordinator.sh finalize"
  fi
}

# ---------------------------------------------------------------------------
# Command: accept (verify + promote participant contribution)
# ---------------------------------------------------------------------------

cmd_accept() {
  local response_file="$1"
  local participant_name="${2:-anonymous}"

  if [ ! -f "$response_file" ]; then
    error "Response file not found: $response_file"
    exit 1
  fi

  STATE=$(read_state)
  CURRENT_ROUND=$(echo "$STATE" | python3 -c "import json,sys; print(json.load(sys.stdin)['currentRound'])")
  CURRENT_CHALLENGE="${CEREMONY_DIR}/challenge_${CURRENT_ROUND}.ptau"

  if [ ! -f "$CURRENT_CHALLENGE" ]; then
    error "Current challenge file not found: $CURRENT_CHALLENGE"
    error "Run 'init' first."
    exit 1
  fi

  log "=== Accepting contribution from: $participant_name ==="
  log "Response file: $response_file"
  log "Previous challenge: $CURRENT_CHALLENGE"

  # Step 1: Verify the contribution
  # snarkjs powersoftau verify checks:
  #   - The response is well-formed
  #   - The response was computed from the previous challenge
  #   - The contribution is valid (no corruption / tampering)
  log "Verifying contribution..."

  VERIFY_OUTPUT=$(npx snarkjs powersoftau verify "$response_file" 2>&1 || true)

  if echo "$VERIFY_OUTPUT" | grep -q "OK"; then
    log "✅ Contribution verified"
  else
    error "Contribution verification failed:"
    error "$VERIFY_OUTPUT"
    exit 1
  fi

  # Step 2: Compute hash of the contribution (for transcript)
  RESPONSE_HASH=$(sha256sum "$response_file" | cut -d' ' -f1)
  log "Contribution hash: $RESPONSE_HASH"

  # Step 3: Promote to next challenge
  NEXT_ROUND=$((CURRENT_ROUND + 1))
  NEXT_CHALLENGE="${CEREMONY_DIR}/challenge_${NEXT_ROUND}.ptau"

  cp "$response_file" "$NEXT_CHALLENGE"
  log "Promoted to challenge_${NEXT_ROUND}.ptau"

  # Step 4: Update state
  add_participant "$participant_name" "$(basename "$response_file")" "$RESPONSE_HASH"

  log ""
  log "✅ Contribution from '$participant_name' accepted (round $((CURRENT_ROUND + 1)))"
  log "Next challenge: $NEXT_CHALLENGE"

  # Check if we have enough participants
  NEW_ROUND=$(echo "$(read_state)" | python3 -c "import json,sys; print(json.load(sys.stdin)['currentRound'])")
  if [ "$NEW_ROUND" -ge "$MIN_PARTICIPANTS" ]; then
    log ""
    log "🎉 Minimum participants ($MIN_PARTICIPANTS) reached!"
    log "Run: bash scripts/mpc/ceremony-coordinator.sh finalize"
  fi
}

# ---------------------------------------------------------------------------
# Command: finalize (complete ceremony → final SRS)
# ---------------------------------------------------------------------------

cmd_finalize() {
  STATE=$(read_state)
  CURRENT_ROUND=$(echo "$STATE" | python3 -c "import json,sys; print(json.load(sys.stdin)['currentRound'])")
  STATUS=$(echo "$STATE" | python3 -c "import json,sys; print(json.load(sys.stdin)['status'])")

  if [ "$STATUS" != "in_progress" ]; then
    error "Ceremony is not in progress (status: $STATUS)"
    exit 1
  fi

  if [ "$CURRENT_ROUND" -lt "$MIN_PARTICIPANTS" ]; then
    error "Not enough participants: $CURRENT_ROUND / $MIN_PARTICIPANTS"
    exit 1
  fi

  LAST_CHALLENGE="${CEREMONY_DIR}/challenge_${CURRENT_ROUND}.ptau"
  FINAL_PTAU="${CEREMONY_DIR}/final.ptau"

  log "=== Finalizing MPC Ceremony ==="
  log "Last challenge: $LAST_CHALLENGE"
  log "Participants: $CURRENT_ROUND"

  # Apply a final random beacon (prevents the last participant from knowing
  # they are last — they can't stop the ceremony to exploit their position)
  log "Applying final random beacon..."
  BEACON=$(openssl rand -hex 32)
  npx snarkjs powersoftau beacon \
    "$LAST_CHALLENGE" \
    "$FINAL_PTAU" \
    "final-beacon-$(date -u +%Y%m%d)" \
    "$BEACON" \
    10 2>/dev/null

  FINAL_HASH=$(sha256sum "$FINAL_PTAU" | cut -d' ' -f1)
  log "Final SRS hash: $FINAL_HASH"
  log "Final SRS file: $FINAL_PTAU ($(du -h "$FINAL_PTAU" | cut -f1))"

  # Extract the verification key (for PLONK setup)
  log ""
  log "Running PLONK setup with final SRS..."

  # For each circuit, run plonk setup
  for circuit in face_verification age_proof employment_proof rate_limit_proof; do
    R1CS_FILE="zk/${circuit}.r1cs"
    ZKEY_FILE="zk/${circuit}_final.zkey"
    VKEY_FILE="zk/${circuit}_vkey.json"

    if [ -f "$R1CS_FILE" ]; then
      log "  Setting up circuit: $circuit"
      npx snarkjs plonk setup "$R1CS_FILE" "$FINAL_PTAU" "$ZKEY_FILE" 2>/dev/null
      npx snarkjs zkey export verificationkey "$ZKEY_FILE" "$VKEY_FILE" 2>/dev/null
      log "  ✅ $circuit: zkey + vkey generated"
    fi
  done

  # Update state
  update_state "status" '"finalized"'
  update_state "finalizedAt" "\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
  update_state "finalSrsHash" "\"$FINAL_HASH\""

  log ""
  log "=== ✅ MPC Ceremony Finalized ==="
  log "Final SRS: $FINAL_PTAU"
  log "SRS hash: $FINAL_HASH"
  log "Participants: $CURRENT_ROUND"
  log ""
  log "Security guarantee:"
  log "  The SRS is secure if AT LEAST ONE of the $CURRENT_ROUND participants was honest."
  log "  Probability of compromise (if all participants collude except 1):"
  log "    P = (1/2)^(discrete_log_complexity) ≈ 2^-128 (negligible)"
  log ""
  log "Generate transcript: bash scripts/mpc/ceremony-coordinator.sh transcript"
}

# ---------------------------------------------------------------------------
# Command: transcript (generate public audit document)
# ---------------------------------------------------------------------------

cmd_transcript() {
  STATE=$(read_state)
  log "=== Generating Ceremony Transcript ==="

  cat > "$TRANSCRIPT_FILE" << 'HEADER'
# VeriFace Edge — MPC Ceremony Transcript

## Overview

This document is the public audit transcript for the VeriFace Edge PLONK
universal SRS (Structured Reference String) multi-party computation (MPC)
ceremony.

## Security Model

The ceremony uses the Perpetual Powers of Tau protocol:

1. Each participant contributes random entropy to the SRS
2. Each contribution is verified by the coordinator before the next participant contributes
3. After N participants, the SRS is secure if AT LEAST ONE participant was honest
4. The coordinator applies a final random beacon (prevents the last participant from exploiting their position)
5. The final SRS + all contributions are published for public audit

**Security guarantee**: The SRS is secure against compromise if at least one
participant destroyed their secret randomness. The probability of compromise
when all but one participant collude is negligible (≈ 2^-128).

## Verification

Anyone can verify the ceremony by:
1. Downloading all challenge/response files from this directory
2. Running: `bash scripts/mpc/verify-ceremony.sh`
3. Confirming the final SRS hash matches the one in this transcript

HEADER

  # Add ceremony metadata
  echo "## Ceremony Details" >> "$TRANSCRIPT_FILE"
  echo "" >> "$TRANSCRIPT_FILE"
  echo "| Property | Value |" >> "$TRANSCRIPT_FILE"
  echo "|----------|-------|" >> "$TRANSCRIPT_FILE"
  echo "| SRS Power | 2^$PTAU_POWER |" >> "$TRANSCRIPT_FILE"
  echo "| Min Participants | $MIN_PARTICIPANTS |" >> "$TRANSCRIPT_FILE"
  echo "| Started | $(echo "$STATE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('startedAt','unknown'))") |" >> "$TRANSCRIPT_FILE"
  echo "| Finalized | $(echo "$STATE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('finalizedAt','unknown'))") |" >> "$TRANSCRIPT_FILE"
  echo "| Final SRS Hash | \`$(echo "$STATE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('finalSrsHash','unknown'))")\` |" >> "$TRANSCRIPT_FILE"
  echo "" >> "$TRANSCRIPT_FILE"

  # Add participant table
  echo "## Participants" >> "$TRANSCRIPT_FILE"
  echo "" >> "$TRANSCRIPT_FILE"
  echo "| # | Name | Contribution Hash | Timestamp |" >> "$TRANSCRIPT_FILE"
  echo "|---|------|-------------------|-----------|" >> "$TRANSCRIPT_FILE"
  echo "$STATE" | python3 -c "
import json, sys
state = json.load(sys.stdin)
for i, p in enumerate(state.get('participants', []), 1):
    print(f'| {i} | {p[\"name\"]} | \`{p[\"hash\"][:32]}...\` | {p[\"timestamp\"]} |')
" >> "$TRANSCRIPT_FILE"
  echo "" >> "$TRANSCRIPT_FILE"

  # Add verification instructions
  cat >> "$TRANSCRIPT_FILE" << 'FOOTER'

## How to Verify

```bash
# 1. Download all ceremony files from: https://github.com/ahmedkobbi/veriface-edge/tree/main/ceremony

# 2. Run the verification script
bash scripts/mpc/verify-ceremony.sh

# 3. Confirm the final SRS hash matches:
#    (see "Final SRS Hash" in the table above)
```

## Files

| File | Description |
|------|-------------|
| `challenge_0.ptau` | Initial challenge (random beacon) |
| `challenge_1.ptau` | After participant 1's contribution |
| `challenge_2.ptau` | After participant 2's contribution |
| ... | ... |
| `challenge_N.ptau` | After participant N's contribution |
| `final.ptau` | Final SRS (after beacon application) |
| `state.json` | Ceremony state (participants, hashes, timestamps) |
| `ceremony.log` | Full ceremony log |

## References

- [Perpetual Powers of Tau](https://github.com/weijiekoh/perpetualpowersoftau)
- [Powers of Tau Protocol](https://eprint.iacr.org/2017/1050)
- [PLONK Paper](https://eprint.iacr.org/2019/953)
- [snarkjs Documentation](https://github.com/iden3/snarkjs)
FOOTER

  log "Transcript generated: $TRANSCRIPT_FILE"
  log ""
  log "Publish this file at: https://github.com/ahmedkobbi/veriface-edge/blob/main/ceremony/TRANSCRIPT.md"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

COMMAND="${1:-status}"
shift || true

case "$COMMAND" in
  init)
    cmd_init
    ;;
  status)
    cmd_status
    ;;
  accept)
    if [ $# -lt 1 ]; then
      echo "Usage: bash ceremony-coordinator.sh accept <response.ptau> [participant_name]"
      exit 1
    fi
    cmd_accept "$1" "${2:-anonymous}"
    ;;
  finalize)
    cmd_finalize
    ;;
  transcript)
    cmd_transcript
    ;;
  *)
    echo "Usage: bash ceremony-coordinator.sh <command>"
    echo ""
    echo "Commands:"
    echo "  init        Initialize the ceremony (generate initial challenge)"
    echo "  status      Show ceremony status + current challenge"
    echo "  accept      Accept + verify a participant's contribution"
    echo "  finalize    Finalize ceremony (apply beacon + generate final SRS)"
    echo "  transcript  Generate public audit transcript"
    exit 1
    ;;
esac
