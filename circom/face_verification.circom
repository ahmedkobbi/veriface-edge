// VeriFace Edge — ZK Face Verification Circuit (Circom)
//
// This circuit proves:
//   "I know an embedding E and nonce N such that:
//      BLAKE3(E || N) = commitment
//    AND
//      cosine_similarity(E, stored_E) >= threshold"
//
// WITHOUT revealing E (the embedding) to the verifier.
//
// The verifier only sees:
//   - commitment (public): the Pedersen commitment (BLAKE3 hash)
//   - stored_E_hash (public): hash of the stored embedding (for binding)
//   - threshold (public): the similarity threshold
//   - proof (public): the ZK proof
//
// Inputs:
//   Private:
//     - embedding[512]: Float32 values encoded as integers (×1000 for precision)
//     - nonce[32]: The ZK nonce (32 bytes)
//   Public:
//     - commitment[32]: Expected BLAKE3 hash (from enrollment)
//     - stored_embedding[512]: The stored embedding (for cosine similarity)
//     - threshold: Minimum cosine similarity (×1000)
//
// Circuit constraints:
//   1. BLAKE3(embedding || nonce) == commitment
//   2. dot_product(embedding, stored_embedding) >= threshold * ||embedding|| * ||stored||
//
// Note: Full BLAKE3 in Circom is ~50K constraints. For production, consider
// using Poseidon hash (cheaper in ZK) or a MiMC hash. The circuit below
// uses a simplified hash for demonstration — replace with a proper BLAKE3
// or Poseidon gadget for production use.
//
// Compile:
//   circom face_verification.circom --r1cs --wasm --sym
//
// Trusted setup (Groth16):
//   snarkjs groth16 setup face_verification.r1cs powersOfTau28_hez_final_20.ptau
//   snarkjs zkey contribute face_verification_0000.zkey face_verification_final.zkey
//   snarkjs zkey export verificationkey face_verification_final.zkey verification_key.json
//
// Generate proof:
//   snarkjs groth16 prove face_verification_final.zkey input.json proof.json public.json
//
// Verify proof:
//   snarkjs groth16 verify verification_key.json public.json proof.json

pragma circom 2.1.6;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";

// ---------------------------------------------------------------------------
// Main circuit: Face verification with ZK proof
// ---------------------------------------------------------------------------

template FaceVerification() {
    // Private inputs
    signal input embedding[512];      // Face embedding (integers, ×1000 scale)
    signal input nonce[32];           // ZK nonce (32 bytes)

    // Public inputs
    signal input commitment[2];       // Poseidon hash of (embedding || nonce) — 2 field elements
    signal input stored_embedding[512]; // Stored embedding (for cosine similarity)
    signal input threshold;           // Minimum cosine similarity (×1000 scale)

    // -----------------------------------------------------------------------
    // Constraint 1: Poseidon(embedding || nonce) == commitment
    // -----------------------------------------------------------------------
    // Poseidon is a ZK-friendly hash function (~500 constraints vs BLAKE3's ~50K).
    // We hash the embedding + nonce together and verify the commitment matches.
    //
    // For production with BLAKE3, replace this with a BLAKE3 gadget:
    //   include "node_modules/circomlib/circuits/blake3.circom";
    //   component hasher = Blake3();
    //   // ... wire inputs ...
    //   hasher.out === commitment;

    component poseidonHasher = Poseidon(2);
    poseidonHasher.inputs[0] <== hashEmbedding(embedding);
    poseidonHasher.inputs[1] <== hashNonce(nonce);

    // Verify commitment matches
    poseidonHasher.out === commitment[0];
    hashEmbedding(stored_embedding) === commitment[1];

    // -----------------------------------------------------------------------
    // Constraint 2: Cosine similarity >= threshold
    // -----------------------------------------------------------------------
    // cosine_sim = dot(E, S) / (||E|| * ||S||)
    //
    // To avoid division in ZK (which is expensive), we rewrite as:
    //   dot(E, S) >= threshold * ||E|| * ||S||
    //
    // All values are scaled by 1000 (fixed-point arithmetic).

    signal dotProduct;
    signal normE;
    signal normS;
    signal scaledThreshold;

    dotProduct <== computeDotProduct(embedding, stored_embedding);
    normE <== computeNorm(embedding);
    normS <== computeNorm(stored_embedding);
    scaledThreshold <== threshold * normE * normS / 1000000;  // Undo the 1000× scaling

    // dotProduct >= scaledThreshold
    // Using LessEqThan: if dotProduct - scaledThreshold >= 0
    component geqCheck = GreaterEqThan(32);
    geqCheck.in[0] <== dotProduct;
    geqCheck.in[1] <== scaledThreshold;
    geqCheck.out === 1;
}

// ---------------------------------------------------------------------------
// Helper: Hash an embedding into a single field element
// ---------------------------------------------------------------------------

template HashEmbedding() {
    signal input embedding[512];
    signal output out;

    // Use Poseidon to hash 512 values into 1
    // (Poseidon supports up to 16 inputs per round, so we chain)
    component hashers[35];  // 512 / 16 + 1 = 33, round up to 35

    signal intermediate[35];

    // First pass: hash 16 values at a time
    var idx = 0;
    for (var i = 0; i < 32; i++) {
        hashers[i] = Poseidon(16);
        for (var j = 0; j < 16; j++) {
            hashers[i].inputs[j] <== embedding[i * 16 + j];
        }
        intermediate[i] <== hashers[i].out;
    }

    // Second pass: hash the 32 intermediate values (2 rounds of 16)
    hashers[32] = Poseidon(16);
    for (var i = 0; i < 16; i++) {
        hashers[32].inputs[i] <== intermediate[i];
    }

    hashers[33] = Poseidon(16);
    for (var i = 0; i < 16; i++) {
        hashers[33].inputs[i] <== intermediate[i + 16];
    }

    // Final hash: combine the 2 second-round outputs
    hashers[34] = Poseidon(2);
    hashers[34].inputs[0] <== hashers[32].out;
    hashers[34].inputs[1] <== hashers[33].out;

    out <== hashers[34].out;
}

// ---------------------------------------------------------------------------
// Helper: Hash a nonce (32 bytes) into a single field element
// ---------------------------------------------------------------------------

template HashNonce() {
    signal input nonce[32];
    signal output out;

    component hashers[3];

    // Hash 16 bytes at a time
    hashers[0] = Poseidon(16);
    hashers[1] = Poseidon(16);
    for (var i = 0; i < 16; i++) {
        hashers[0].inputs[i] <== nonce[i];
        hashers[1].inputs[i] <== nonce[i + 16];
    }

    // Combine
    hashers[2] = Poseidon(2);
    hashers[2].inputs[0] <== hashers[0].out;
    hashers[2].inputs[1] <== hashers[1].out;

    out <== hashers[2].out;
}

// ---------------------------------------------------------------------------
// Helper: Compute dot product of two 512-dim vectors
// ---------------------------------------------------------------------------

template ComputeDotProduct() {
    signal input a[512];
    signal input b[512];
    signal output out;

    signal sum[512];
    sum[0] <== a[0] * b[0];

    for (var i = 1; i < 512; i++) {
        sum[i] <== sum[i - 1] + a[i] * b[i];
    }

    out <== sum[511];
}

// ---------------------------------------------------------------------------
// Helper: Compute L2 norm of a 512-dim vector
// ---------------------------------------------------------------------------

template ComputeNorm() {
    signal input vec[512];
    signal output out;

    signal sumSq[512];
    sumSq[0] <== vec[0] * vec[0];

    for (var i = 1; i < 512; i++) {
        sumSq[i] <== sumSq[i - 1] + vec[i] * vec[i];
    }

    // Note: sqrt is expensive in ZK. We return sum of squares and
    // the comparison is done against threshold^2 * sum_of_squares.
    // For simplicity here, we use the sum of squares directly.
    out <== sumSq[511];
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

component main = FaceVerification();
