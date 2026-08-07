#!/usr/bin/env bash
#
# VeriFace Edge — ZK Trusted Setup Ceremony Script
#
# Generates the proving key + verification key for the Groth16 zk-SNARK
# face verification circuit.
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
# Ceremony:
#   Groth16 requires a trusted setup. This script uses the Powers of Tau
#   ceremony output from Hermez (https://github.com/hermez/snarkjs#trusted-setup)
#   + a circuit-specific phase. For production, replace with your own
#   multi-party ceremony (see https://github.com/weijiekoh/perpetualpowersoftau).

set -euo pipefail

CIRCUIT_NAME="face_verification"
CIRCUIT_FILE="circom/${CIRCUIT_NAME}.circom"
ZK_DIR="zk"
PTAU_FILE="${ZK_DIR}/powersOfTau28_hez_final_20.ptau"
PTAU_URL="https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_20.ptau"

echo "=== VeriFace Edge — ZK Trusted Setup ==="
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

# Download Powers of Tau (if not present)
echo "[2/6] Downloading Powers of Tau ceremony file..."
if [ ! -f "${PTAU_FILE}" ]; then
    echo "   Downloading ${PTAU_URL}..."
    curl -L -o "${PTAU_FILE}" "${PTAU_URL}"
    echo "✅ Downloaded $(du -h ${PTAU_FILE} | cut -f1)"
else
    echo "✅ Already present: ${PTAU_FILE} ($(du -h ${PTAU_FILE} | cut -f1))"
fi
echo ""

# Compile the circuit
echo "[3/6] Compiling Circom circuit..."
cd circom
circom "${CIRCUIT_NAME}.circom" --r1cs --wasm --sym -o "../${ZK_DIR}"
cd ..
echo "✅ Compiled: ${ZK_DIR}/${CIRCUIT_NAME}.r1cs"
echo "   Constraints: $(npx snarkjs r1cs info ${ZK_DIR}/${CIRCUIT_NAME}.r1cs 2>/dev/null | grep 'Constraints' || echo 'unknown')"
echo ""

# Phase 2: Circuit-specific trusted setup
echo "[4/6] Running circuit-specific trusted setup..."
npx snarkjs groth16 setup \
    "${ZK_DIR}/${CIRCUIT_NAME}.r1cs" \
    "${PTAU_FILE}" \
    "${ZK_DIR}/${CIRCUIT_NAME}_0000.zkey"
echo "✅ Initial proving key: ${ZK_DIR}/${CIRCUIT_NAME}_0000.zkey"
echo ""

# Contribute to the ceremony (random beacon)
echo "[5/6] Contributing to ceremony (random beacon)..."
npx snarkjs zkey contribute \
    "${ZK_DIR}/${CIRCUIT_NAME}_0000.zkey" \
    "${ZK_DIR}/${CIRCUIT_NAME}_final.zkey" \
    --name="VeriFace-Edge-$(date +%Y%m%d)" \
    -e="$(openssl rand -hex 32)"
echo "✅ Final proving key: ${ZK_DIR}/${CIRCUIT_NAME}_final.zkey ($(du -h ${ZK_DIR}/${CIRCUIT_NAME}_final.zkey | cut -f1))"
echo ""

# Export verification key
echo "[6/6] Exporting verification key..."
npx snarkjs zkey export verificationkey \
    "${ZK_DIR}/${CIRCUIT_NAME}_final.zkey" \
    "${ZK_DIR}/verification_key.json"
echo "✅ Verification key: ${ZK_DIR}/verification_key.json ($(du -h ${ZK_DIR}/verification_key.json | cut -f1))"
echo ""

# Summary
echo "=== Trusted Setup Complete ==="
echo ""
echo "Files generated:"
echo "  ${ZK_DIR}/${CIRCUIT_NAME}.r1cs             — R1CS constraints"
echo "  ${ZK_DIR}/${CIRCUIT_NAME}_js/              — Witness generator"
echo "  ${ZK_DIR}/${CIRCUIT_NAME}_final.zkey       — Proving key (distribute to SDK)"
echo "  ${ZK_DIR}/verification_key.json            — Verification key (keep on backend)"
echo ""
echo "Next steps:"
echo "  1. Copy ${ZK_DIR}/${CIRCUIT_NAME}_final.zkey to your CDN (SDK loads it at runtime)"
echo "  2. Copy ${ZK_DIR}/verification_key.json to the backend (used by src/lib/zk-verifier.ts)"
echo "  3. Set tenant.requireZkProof = true to enforce ZK proofs"
echo ""
echo "⚠️  SECURITY: The proving key contains toxic waste from the trusted setup."
echo "   For production, perform a multi-party ceremony (MPC) to eliminate trust:"
echo "   https://github.com/weijiekoh/perpetualpowersoftau"
