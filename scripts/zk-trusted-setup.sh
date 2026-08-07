#!/usr/bin/env bash
#
# VeriFace Edge — ZK Trusted Setup Ceremony Script (PLONK)
#
# Generates the proving key + verification key for PLONK zk-SNARK proofs.
#
# PLONK uses a UNIVERSAL trusted setup (Structured Reference String / SRS)
# from the Powers of Tau ceremony. This means:
#   - ONE ceremony covers ALL circuits up to N constraints
#   - No circuit-specific trusted setup phase (unlike Groth16)
#   - When the circuit changes, just re-run this script — no new ceremony
#   - The SRS is updatable: anyone can contribute to make it more secure
#
# Prerequisites:
#   - Node.js 18+ (for snarkjs)
#   - Circom compiler (https://docs.circom.io/getting-started/installation/)
#
# Usage:
#   bash scripts/zk-trusted-setup.sh
#
# Output:
#   zk/face_verification.r1cs       — R1CS constraint file
#   zk/face_verification_js/        — Witness generator (WASM + JS)
#   zk/face_verification_final.zkey — Proving key (~50MB)
#   zk/verification_key.json        — Verification key (~2KB)
#
# Universal setup:
#   PLONK's SRS is universal — the same Powers of Tau file works for all
#   circuits. To update the SRS (add more participants for stronger security):
#     snarkjs powersoftau contribute powersOfTau28_hez_final_20.ptau new.ptau \
#       --name="Your-Name" -e="$(openssl rand -hex 32)"
#
#   For production, perform a multi-party ceremony (MPC):
#     https://github.com/weijiekoh/perpetualpowersoftau

set -euo pipefail

CIRCUIT_NAME="face_verification"
CIRCUIT_FILE="circom/${CIRCUIT_NAME}.circom"
ZK_DIR="zk"
PTAU_FILE="${ZK_DIR}/powersOfTau28_hez_final_20.ptau"
PTAU_URL="https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_20.ptau"

echo "=== VeriFace Edge — ZK Trusted Setup (PLONK) ==="
echo ""
echo "PLONK uses a UNIVERSAL setup — one ceremony covers all circuits."
echo "No circuit-specific trusted setup phase needed (unlike Groth16)."
echo ""

# Check prerequisites
echo "[1/6] Checking prerequisites..."
if ! command -v circom &> /dev/null; then
    echo "❌ circom not found. Install: https://docs.circom.io/getting-started/installation/"
    exit 1
fi

if ! command -v npx &> /dev/null; then
    echo "❌ npx not found. Install Node.js 18+"
    exit 1
fi

echo "✅ circom: $(circom --version)"
echo "✅ npx: $(npx --version)"
echo ""

# Create zk directory
mkdir -p "${ZK_DIR}"

# Check circuit file
if [ ! -f "${CIRCUIT_FILE}" ]; then
    echo "❌ Circuit file not found: ${CIRCUIT_FILE}"
    exit 1
fi

# Download Powers of Tau (universal SRS — if not present)
echo "[2/6] Downloading universal Powers of Tau SRS..."
if [ ! -f "${PTAU_FILE}" ]; then
    echo "   Downloading ${PTAU_URL}..."
    curl -L -o "${PTAU_FILE}" "${PTAU_URL}"
    echo "✅ Downloaded $(du -h ${PTAU_FILE} | cut -f1)"
    echo ""
    echo "   ℹ️  This SRS is universal — it works for ALL PLONK circuits."
    echo "   ℹ️  For production, contribute your own randomness:"
    echo "      snarkjs powersoftau contribute ${PTAU_FILE} new.ptau \\"
    echo "        --name='Your-Name' -e=\"\$(openssl rand -hex 32)\""
else
    echo "✅ Already present: ${PTAU_FILE} ($(du -h ${PTAU_FILE} | cut -f1))"
    echo "   (Universal — reusable for all circuit versions)"
fi
echo ""

# Compile the circuit
echo "[3/6] Compiling Circom circuit..."
cd circom
circom "${CIRCUIT_NAME}.circom" --r1cs --wasm --sym -o "../${ZK_DIR}"
cd ..
echo "✅ Compiled: ${ZK_DIR}/${CIRCUIT_NAME}.r1cs"
R1CS_INFO=$(npx snarkjs r1cs info "${ZK_DIR}/${CIRCUIT_NAME}.r1cs" 2>/dev/null || echo "")
if [ -n "${R1CS_INFO}" ]; then
    echo "   ${R1CS_INFO}" | head -5
fi
echo ""

# PLONK setup (universal — no circuit-specific ceremony phase!)
echo "[4/6] Running PLONK setup (universal SRS)..."
echo "   (No circuit-specific trusted setup needed — PLONK advantage over Groth16)"
npx snarkjs plonk setup \
    "${ZK_DIR}/${CIRCUIT_NAME}.r1cs" \
    "${PTAU_FILE}" \
    "${ZK_DIR}/${CIRCUIT_NAME}_final.zkey"
echo "✅ Proving key: ${ZK_DIR}/${CIRCUIT_NAME}_final.zkey ($(du -h ${ZK_DIR}/${CIRCUIT_NAME}_final.zkey | cut -f1))"
echo ""

# Optional: Contribute to the universal SRS (for stronger security)
echo "[5/6] SRS contribution (optional — strengthens the universal setup)..."
read -p "   Contribute to the universal SRS? (y/N) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    CONTRIBUTION_NAME="VeriFace-Edge-$(date +%Y%m%d)-$(openssl rand -hex 4)"
    npx snarkjs powersoftau contribute \
        "${PTAU_FILE}" \
        "${ZK_DIR}/powersOfTau_contributed.ptau" \
        --name="${CONTRIBUTION_NAME}" \
        -e="$(openssl rand -hex 32)"
    echo "✅ Contributed to universal SRS: ${ZK_DIR}/powersOfTau_contributed.ptau"
    echo "   Use this file instead of the downloaded one for future setups."
    # Re-run setup with the contributed SRS
    npx snarkjs plonk setup \
        "${ZK_DIR}/${CIRCUIT_NAME}.r1cs" \
        "${ZK_DIR}/powersOfTau_contributed.ptau" \
        "${ZK_DIR}/${CIRCUIT_NAME}_final.zkey"
    echo "✅ Re-generated proving key with contributed SRS"
fi
echo ""

# Export verification key
echo "[6/6] Exporting verification key..."
npx snarkjs zkey export verificationkey \
    "${ZK_DIR}/${CIRCUIT_NAME}_final.zkey" \
    "${ZK_DIR}/verification_key.json"

# Verify the key is PLONK
PROTOCOL=$(python3 -c "import json; print(json.load(open('${ZK_DIR}/verification_key.json')).get('protocol', 'unknown'))" 2>/dev/null || echo "unknown")
echo "✅ Verification key: ${ZK_DIR}/verification_key.json ($(du -h ${ZK_DIR}/verification_key.json | cut -f1))"
echo "   Protocol: ${PROTOCOL}"
echo ""

if [ "${PROTOCOL}" != "plonk" ]; then
    echo "⚠️  WARNING: Verification key protocol is '${PROTOCOL}', expected 'plonk'"
    echo "   The backend will reject PLONK proofs. Re-run this script."
    exit 1
fi

# Summary
echo "=== PLONK Trusted Setup Complete ==="
echo ""
echo "Files generated:"
echo "  ${ZK_DIR}/${CIRCUIT_NAME}.r1cs             — R1CS constraints"
echo "  ${ZK_DIR}/${CIRCUIT_NAME}_js/              — Witness generator (WASM + JS)"
echo "  ${ZK_DIR}/${CIRCUIT_NAME}_final.zkey       — Proving key (distribute to SDK)"
echo "  ${ZK_DIR}/verification_key.json            — Verification key (backend)"
echo "  ${PTAU_FILE}                               — Universal SRS (reusable!)"
echo ""
echo "✅ PLONK advantage: When the circuit changes, just re-run this script."
echo "   No new trusted setup ceremony needed (universal SRS is reusable)."
echo ""
echo "Next steps:"
echo "  1. Copy ${ZK_DIR}/${CIRCUIT_NAME}_final.zkey to your CDN (SDK loads it at runtime)"
echo "  2. Copy ${ZK_DIR}/verification_key.json to the backend (used by src/lib/zk-verifier.ts)"
echo "  3. Set tenant.requireZkProof = true to enforce ZK proofs"
echo ""
echo "⚠️  SECURITY: For production, perform a multi-party ceremony (MPC) on the SRS:"
echo "   https://github.com/weijiekoh/perpetualpowersoftau"
echo "   This eliminates trust in any single party."
echo ""
echo "📚 Documentation: docs/POST_QUANTUM_ZK_MIGRATION.md"
