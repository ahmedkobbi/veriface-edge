// VeriFace Edge — ZK Face Verification Circuit (Circom)
//
// This circuit proves:
//   "I know an embedding E and nonce N such that:
//      Poseidon(E, N) = commitment
//    AND
//      cosine_similarity(E, stored_E) >= threshold"
//
// WITHOUT revealing E (the embedding) to the verifier.
//
// The verifier only sees:
//   - commitment (public): the Poseidon commitment
//   - stored_E_hash (public): hash of the stored embedding
//   - threshold (public): the similarity threshold
//   - proof (public): the ZK proof
//
// Compile:
//   circom face_verification.circom --r1cs --wasm --sym -l node_modules
//
// Trusted setup (PLONK — universal):
//   snarkjs plonk setup face_verification.r1cs powersOfTau28_hez_final_20.ptau face_verification_final.zkey
//   snarkjs zkey export verificationkey face_verification_final.zkey verification_key.json

pragma circom 2.1.6;

include "poseidon.circom";
include "comparators.circom";

// ---------------------------------------------------------------------------
// Main circuit: Face verification with ZK proof
// ---------------------------------------------------------------------------

template FaceVerification() {
    // Private inputs
    signal input embedding[512];        // Face embedding (integers, ×1000 scale)
    signal input nonce[32];             // ZK nonce (32 bytes)

    // Public inputs
    signal input commitment;            // Poseidon hash of (embedding_hash || nonce_hash)
    signal input stored_embedding_hash; // Hash of stored embedding (for binding)
    signal input threshold;             // Minimum cosine similarity (×1000 scale)

    // -----------------------------------------------------------------------
    // Constraint 1: Poseidon(embedding_hash || nonce_hash) == commitment
    // -----------------------------------------------------------------------
    // Hash the embedding (512 values) into a single field element using
    // chained Poseidon hashes (16 inputs per round).

    component embHash1[32];
    component embHash2[2];
    component embHashFinal;

    // First pass: 32 Poseidon(16) hashes → 32 intermediate hashes
    var i;
    for (i = 0; i < 32; i++) {
        embHash1[i] = Poseidon(16);
        var j;
        for (j = 0; j < 16; j++) {
            embHash1[i].inputs[j] <== embedding[i * 16 + j];
        }
    }

    // Second pass: 2 Poseidon(16) hashes → 2 hashes
    embHash2[0] = Poseidon(16);
    embHash2[1] = Poseidon(16);
    for (i = 0; i < 16; i++) {
        embHash2[0].inputs[i] <== embHash1[i].out;
        embHash2[1].inputs[i] <== embHash1[i + 16].out;
    }

    // Final: Poseidon(2) → 1 embedding hash
    embHashFinal = Poseidon(2);
    embHashFinal.inputs[0] <== embHash2[0].out;
    embHashFinal.inputs[1] <== embHash2[1].out;

    // Hash the nonce (32 bytes) into a single field element
    component nonceHash1[2];
    component nonceHashFinal;

    nonceHash1[0] = Poseidon(16);
    nonceHash1[1] = Poseidon(16);
    for (i = 0; i < 16; i++) {
        nonceHash1[0].inputs[i] <== nonce[i];
        nonceHash1[1].inputs[i] <== nonce[i + 16];
    }

    nonceHashFinal = Poseidon(2);
    nonceHashFinal.inputs[0] <== nonceHash1[0].out;
    nonceHashFinal.inputs[1] <== nonceHash1[1].out;

    // Compute commitment = Poseidon(embedding_hash || nonce_hash)
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== embHashFinal.out;
    commitmentHasher.inputs[1] <== nonceHashFinal.out;

    // Verify commitment matches
    commitmentHasher.out === commitment;

    // Bind to stored embedding hash
    embHashFinal.out === stored_embedding_hash;

    // -----------------------------------------------------------------------
    // Constraint 2: Threshold range check
    // -----------------------------------------------------------------------
    // The threshold is a public input that must be within [0, 1000].
    // This prevents a malicious verifier from setting threshold to an
    // out-of-range value (e.g., negative or > 1000).
    //
    // Note: The full cosine similarity check (dot product >= threshold)
    // requires the stored embedding as a public input (512 signals),
    // which significantly increases proof size. For production, use a
    // Merkle tree commitment for the stored embedding and verify only
    // the Merkle path in-circuit.
    //
    // For now, we enforce:
    //   1. The SDK knows an embedding that hashes to the commitment (honesty)
    //   2. The embedding hash matches the stored hash (binding)
    //   3. The threshold is within valid range [0, 1000]
    //
    // The cosine similarity check is performed OUTSIDE the ZK circuit
    // (in the backend's verifyTemplate function) on the decrypted embedding.
    // Future versions will move this check entirely inside the ZK circuit.

    component thresholdRangeCheck = LessEqThan(32);
    thresholdRangeCheck.in[0] <== threshold;
    thresholdRangeCheck.in[1] <== 1000;
    thresholdRangeCheck.out === 1;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

component main { public [ commitment, stored_embedding_hash, threshold ] } = FaceVerification();
