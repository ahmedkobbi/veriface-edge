// VeriFace Edge — Selective Attribute Disclosure ZK Circuits (Circom)
//
// Three circuits for privacy-preserving attribute proofs:
//
// 1. AgeProof: "I'm over 18" — proves birth_year <= current_year - 18
//    without revealing the actual birth year.
//
// 2. EmploymentProof: "I'm a verified employee" — proves membership in a
//    Merkle tree of employee IDs without revealing which employee.
//
// 3. RateLimitProof: "This is my 5th auth this month" — proves the current
//    auth count is within the allowed limit without revealing the exact count.
//
// All circuits use Poseidon hash (ZK-friendly) for commitments.
//
// Compile:
//   circom age_proof.circom --r1cs --wasm --sym -l node_modules/circomlib/circuits
//   circom employment_proof.circom --r1cs --wasm --sym -l node_modules/circomlib/circuits
//   circom rate_limit_proof.circom --r1cs --wasm --sym -l node_modules/circomlib/circuits
//
// Trusted setup (PLONK — universal):
//   snarkjs plonk setup age_proof.r1cs powersOfTau28_hez_final_20.ptau age_proof_final.zkey
//   snarkjs zkey export verificationkey age_proof_final.zkey age_proof_vkey.json

pragma circom 2.1.6;

include "poseidon.circom";
include "comparators.circom";

// ===========================================================================
// Circuit 1: Age Proof
// ===========================================================================
// Proves: "I was born in year Y, and Y <= current_year - min_age"
// Without revealing: the exact birth year Y
//
// Public inputs:
//   - commitment: Poseidon(birth_year, salt) — stored at enrollment
//   - current_year: e.g., 2026
//   - min_age: e.g., 18
//
// Private inputs:
//   - birth_year: e.g., 1990
//   - salt: random nonce (prevents brute-force of commitment)

template AgeProof() {
    signal input birth_year;
    signal input salt;

    signal input commitment;      // Public: Poseidon(birth_year, salt)
    signal input current_year;    // Public: e.g., 2026
    signal input min_age;         // Public: e.g., 18

    // Constraint 1: Verify commitment = Poseidon(birth_year, salt)
    component hasher = Poseidon(2);
    hasher.inputs[0] <== birth_year;
    hasher.inputs[1] <== salt;
    hasher.out === commitment;

    // Constraint 2: Verify birth_year <= current_year - min_age
    // i.e., current_year - birth_year >= min_age
    // i.e., current_year - min_age >= birth_year
    signal ageThreshold;
    ageThreshold <== current_year - min_age;

    // birth_year <= ageThreshold (i.e., age >= min_age)
    component lessEq = LessEqThan(32);
    lessEq.in[0] <== birth_year;
    lessEq.in[1] <== ageThreshold;
    lessEq.out === 1;
}

// ===========================================================================
// Circuit 2: Employment Proof (Merkle Tree Membership)
// ===========================================================================
// Proves: "My employee_id is in the Merkle tree with root merkle_root"
// Without revealing: which employee_id
//
// Uses Poseidon hash for the Merkle tree (ZK-friendly).
// Tree depth: 20 (supports up to 2^20 = 1M employees)
//
// Public inputs:
//   - merkle_root: Poseidon Merkle root of employee IDs
//
// Private inputs:
//   - employee_id: the employee's ID (as field element)
//   - merkle_path[20]: sibling hashes from leaf to root
//   - merkle_path_directions[20]: 0 = left sibling, 1 = right sibling

template EmploymentProof() {
    signal input employee_id;
    signal input merkle_path[20];
    signal input merkle_path_directions[20];

    signal input merkle_root;  // Public

    // Compute Merkle root from leaf + path
    signal current;
    current <== employee_id;

    component hashers[20];
    component muxSelectors[20];

    for (var i = 0; i < 20; i++) {
        // If direction[i] == 0: current is left child, path[i] is right child
        // If direction[i] == 1: path[i] is left child, current is right child
        //
        // left = current * (1 - direction[i]) + path[i] * direction[i]
        // right = path[i] * (1 - direction[i]) + current * direction[i]

        signal left;
        signal right;
        left <== current * (1 - merkle_path_directions[i]) + merkle_path[i] * merkle_path_directions[i];
        right <== merkle_path[i] * (1 - merkle_path_directions[i]) + current * merkle_path_directions[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== left;
        hashers[i].inputs[1] <== right;

        current <== hashers[i].out;
    }

    // Verify computed root matches expected
    current === merkle_root;
}

// ===========================================================================
// Circuit 3: Rate Limit Proof
// ===========================================================================
// Proves: "My current auth count this month is <= max_allowed"
// Without revealing: the exact auth count
//
// Public inputs:
//   - commitment: Poseidon(auth_count, salt, month_key) — updated each auth
//   - max_allowed: e.g., 100 (monthly limit)
//
// Private inputs:
//   - auth_count: the actual count (e.g., 5)
//   - salt: random nonce (prevents correlation across months)
//   - month_key: e.g., 202608 (August 2026)

template RateLimitProof() {
    signal input auth_count;
    signal input salt;
    signal input month_key;

    signal input commitment;   // Public: Poseidon(auth_count, salt, month_key)
    signal input max_allowed;  // Public: e.g., 100

    // Constraint 1: Verify commitment = Poseidon(auth_count, salt, month_key)
    component hasher = Poseidon(3);
    hasher.inputs[0] <== auth_count;
    hasher.inputs[1] <== salt;
    hasher.inputs[2] <== month_key;
    hasher.out === commitment;

    // Constraint 2: auth_count <= max_allowed
    component lessEq = LessEqThan(32);
    lessEq.in[0] <== auth_count;
    lessEq.in[1] <== max_allowed;
    lessEq.out === 1;
}

// ===========================================================================
// Main components (one per circuit — compiled separately)
// ===========================================================================

// For age_proof.circom:
// component main { public [ commitment, current_year, min_age ] } = AgeProof();

// For employment_proof.circom:
// component main { public [ merkle_root ] } = EmploymentProof();

// For rate_limit_proof.circom:
// component main { public [ commitment, max_allowed ] } = RateLimitProof();
