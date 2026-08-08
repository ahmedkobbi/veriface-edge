# VeriFace Edge — MPC Ceremony Documentation

## Overview

VeriFace Edge uses a **multi-party computation (MPC) ceremony** to generate the universal SRS (Structured Reference String) for PLONK zk-SNARK proofs. This replaces the single-party trusted setup with a cryptographically secure process.

## Why MPC?

### The Trusted Setup Problem

PLONK (and all zk-SNARKs) require a "structured reference string" (SRS) — a set of pre-computed values that the prover and verifier share. The SRS is generated from a **secret trapdoor** (a random number). If anyone knows this trapdoor, they can forge fake proofs.

**Single-party setup**: One person generates the SRS. If they're compromised (or malicious), they can forge proofs. This is the "toxic waste" problem.

**MPC setup**: Multiple participants each contribute random entropy to the SRS. Each contribution destroys the previous participant's trapdoor. After N participants, the SRS is secure if **at least one participant was honest** (i.e., destroyed their secret).

### Security Guarantee

```
If N participants contribute, and at least ONE is honest:
  → The trapdoor is destroyed
  → No one can forge proofs
  → The SRS is cryptographically secure

Probability of compromise (if all but one collude):
  P ≈ 2^-128 (negligible — practically impossible)
```

This is the same security model used by:
- **Zcash** (Powers of Tau ceremony, 90+ participants)
- **Ethereum** (KZG ceremony, 140K+ contributions)
- **Filecoin** (Phase 2 ceremony)
- **Scroll** (zkEVM ceremony)

---

## Protocol: Perpetual Powers of Tau

### How It Works

```
┌─────────────────────────────────────────────────────────┐
│  Step 1: Coordinator generates initial challenge        │
│  challenge_0.ptau = PowersOfTau(2^20, random_beacon)   │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Step 2: Participant 1 contributes                      │
│  1. Downloads challenge_0.ptau                          │
│  2. Generates secret randomness (from /dev/urandom +    │
│     keystrokes)                                         │
│  3. Computes response_1.ptau = Contribute(challenge_0,  │
│     secret_1)                                           │
│  4. Uploads response_1.ptau                             │
│  5. DESTROYS secret_1 (wiped from memory + disk)        │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Step 3: Coordinator verifies + promotes                │
│  1. Verifies response_1.ptau (checks contribution is    │
│     valid + derived from challenge_0)                   │
│  2. Promotes: challenge_1.ptau = response_1.ptau        │
│  3. Shares challenge_1.ptau with participant 2          │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Step 4: Participant 2 contributes (same as step 2)     │
│  ...                                                    │
└───────────────────────┬─────────────────────────────────┘
                        │
                   (repeat for N participants)
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Step N+1: Coordinator applies final beacon              │
│  final.ptau = Beacon(challenge_N.ptau, random_beacon)   │
│  (The beacon prevents the last participant from knowing │
│   they are last — they can't stop to exploit position)  │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Step N+2: Coordinator finalizes                         │
│  1. Runs PLONK setup with final.ptau for each circuit   │
│  2. Generates proving keys (.zkey) + verification keys  │
│  3. Publishes ceremony transcript for public audit      │
└─────────────────────────────────────────────────────────┘
```

### Why the Final Beacon?

The last participant in the chain has a special position — they know they are last (if the coordinator announces it). They could withhold their contribution if they don't like the result.

The **final beacon** applies one more random transformation using a public, unpredictable value (e.g., a future Bitcoin block hash). This ensures no participant knows they are last, because the beacon is applied AFTER all contributions.

---

## Ceremony Roles

### Coordinator

The coordinator manages the ceremony flow:
1. Generates the initial challenge
2. Distributes challenges to participants
3. Verifies each contribution
4. Promotes verified contributions to the next challenge
5. Applies the final beacon
6. Generates the final SRS + verification keys
7. Publishes the ceremony transcript

**The coordinator CANNOT forge proofs** — they don't know any participant's secret. Their role is purely organizational.

### Participant

Each participant:
1. Downloads the current challenge
2. Generates random entropy (from OS CSPRNG + keystrokes)
3. Applies their contribution (updates the SRS)
4. Uploads the response
5. **Destroys their secret** (wiped from memory + disk)

**The participant's secret is never stored or transmitted** — it exists only in RAM for the duration of the contribution, then is securely wiped.

### Public Verifier

Anyone can verify the ceremony after it's complete:
1. Download all challenge/response files
2. Run `bash scripts/mpc/verify-ceremony.sh`
3. Confirm the final SRS hash matches the transcript

---

## Running the Ceremony

### 1. Coordinator: Initialize

```bash
# Set ceremony parameters
export MPC_CEREMONY_DIR=./ceremony
export MPC_PTAU_POWER=20        # 2^20 = 1M constraints (enough for all circuits)
export MPC_MIN_PARTICIPANTS=10   # At least 10 participants

# Initialize
bash scripts/mpc/ceremony-coordinator.sh init
```

This generates `challenge_0.ptau` — the initial challenge.

### 2. Participant: Contribute

Each participant (on their own machine):

```bash
# Download challenge_0.ptau from the coordinator
# (via secure channel — Signal, encrypted email, etc.)

# Contribute
bash scripts/mpc/participant-contribute.sh challenge_0.ptau response_1.ptau "Alice <alice@example.com>"

# Upload response_1.ptau back to the coordinator
# (the participant's secret is already wiped)
```

### 3. Coordinator: Accept + Verify

```bash
# Accept Alice's contribution
bash scripts/mpc/ceremony-coordinator.sh accept response_1.ptau "Alice <alice@example.com>"

# Check status
bash scripts/mpc/ceremony-coordinator.sh status
# → Shows: 1/10 participants, challenge_1.ptau ready for next participant
```

### 4. Repeat for All Participants

```bash
# Participant 2
bash scripts/mpc/participant-contribute.sh ceremony/challenge_1.ptau response_2.ptau "Bob"
bash scripts/mpc/ceremony-coordinator.sh accept response_2.ptau "Bob"

# Participant 3
bash scripts/mpc/participant-contribute.sh ceremony/challenge_2.ptau response_3.ptau "Charlie"
bash scripts/mpc/ceremony-coordinator.sh accept response_3.ptau "Charlie"

# ... repeat until MIN_PARTICIPANTS reached ...
```

### 5. Coordinator: Finalize

```bash
# After all contributions
bash scripts/mpc/ceremony-coordinator.sh finalize
```

This:
- Applies the final random beacon
- Runs PLONK setup for each circuit (face_verification, age_proof, employment_proof, rate_limit_proof)
- Generates proving keys + verification keys
- Computes the final SRS hash

### 6. Coordinator: Publish Transcript

```bash
bash scripts/mpc/ceremony-coordinator.sh transcript
```

This generates `ceremony/TRANSCRIPT.md` — a public audit document with:
- Ceremony parameters (power, min participants)
- All participant names + contribution hashes
- Final SRS hash
- Verification instructions

### 7. Public: Verify

Anyone can verify the ceremony:

```bash
# Clone the repo (includes ceremony/ directory)
git clone https://github.com/ahmedkobbi/veriface-edge.git
cd veriface-edge

# Verify
bash scripts/mpc/verify-ceremony.sh
```

---

## Security Best Practices for Participants

### 1. Use a Dedicated Machine

- Use a live USB (Tails, Ubuntu Live) booted from a clean USB
- Don't use your daily-driver machine (may have malware)
- Disconnect from the internet after downloading the challenge
- Reboot after contributing (clears RAM)

### 2. Generate Strong Entropy

- Type random characters (timing between keystrokes adds entropy)
- Move the mouse randomly (if GUI available)
- The script combines: /dev/urandom + keystrokes + process state

### 3. Destroy the Secret

- The script automatically wipes the secret from memory
- For maximum security: physically destroy the USB drive after contributing
- Or: use `shred` on the USB drive's partition

### 4. Verify the Challenge

- Before contributing, verify the challenge hash matches what the coordinator published
- This prevents man-in-the-middle attacks

---

## SRS File Management

### Large File Handling

The SRS files are large (1.2GB for 2^20 power). They are NOT stored in git.

| File | Size | Storage |
|------|------|---------|
| `challenge_0.ptau` | ~1.2GB | S3 / IPFS |
| `challenge_N.ptau` | ~1.2GB | S3 / IPFS |
| `final.ptau` | ~1.2GB | S3 / IPFS (permanent) |
| `*.zkey` (proving keys) | ~50-500MB | CDN (SDK downloads at runtime) |
| `*_vkey.json` (verification keys) | ~2KB | Git (committed to repo) |

### Distribution

- **SRS files**: Distributed via S3 + IPFS (content-addressed, immutable)
- **Proving keys**: Distributed via CDN (Cloudflare)
- **Verification keys**: Committed to git (small, public, can be audited)
- **Transcript**: Committed to git (`ceremony/TRANSCRIPT.md`)

---

## Cryptographic Details

### SRS Structure

The Powers of Tau SRS contains:
- `τ^0, τ^1, τ^2, ..., τ^(2^N-1)` (powers of the secret τ)
- `α^0, α^1, ..., α^(N-1)` (powers of the secret α)
- All as points on the BN254 elliptic curve (G1 + G2)

### Why It's Secure

The security relies on the **discrete logarithm problem** (DLP):
- Given `τ * G` (a point on the curve), finding `τ` is computationally infeasible
- Each participant's contribution transforms `τ → τ' = f(τ, secret_i)`
- After N contributions, `τ' = f(τ, secret_1, secret_2, ..., secret_N)`
- To recover `τ'`, an attacker must know ALL secrets — but each participant destroyed theirs

### Formal Security Proof

**Theorem**: If at least one participant is honest (destroyed their secret), the SRS is secure.

**Proof sketch**:
1. The SRS is parameterized by (τ, α) — the "trapdoor"
2. Participant i transforms (τ, α) → (τ', α') using their secret (s_i, t_i)
3. The transformation is: τ' = τ^(s_i), α' = α^(t_i)
4. After N participants: τ_final = τ^(s_1 * s_2 * ... * s_N)
5. To recover τ_final, an attacker needs s_1 * s_2 * ... * s_N
6. If participant k is honest, s_k is unknown to the attacker
7. Without s_k, the attacker cannot compute the product (DLP hardness)
8. Therefore, τ_final is unknown to the attacker → SRS is secure ∎

**Reference**: [Powers of Tau Paper](https://eprint.iacr.org/2017/1050)

---

## References

- [Perpetual Powers of Tau](https://github.com/weijiekoh/perpetualpowersoftau)
- [Powers of Tau Protocol (Bowden et al.)](https://eprint.iacr.org/2017/1050)
- [Zcash Ceremony](https://z.cash/technology/paramgen/)
- [Ethereum KZG Ceremony](https://ceremony.ethereum.org/)
- [PLONK Paper](https://eprint.iacr.org/2019/953)
- [snarkjs Documentation](https://github.com/iden3/snarkjs)
