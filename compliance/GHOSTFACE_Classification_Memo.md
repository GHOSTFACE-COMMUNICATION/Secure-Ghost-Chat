# GHOSTFACE — Export-Control Classification: Technical Memorandum for Counsel

**From:** Benjamin Henderson, Director, Ghostface Limited (NZ)
**Re:** Encryption classification for App Store / Play Store distribution
**Date:** 19 August 2026
**Status:** Company's technical understanding, prepared to focus counsel's review. **Not legal advice and not a self-classification decision** — we are seeking counsel's opinion on the questions in §5.

---

## 1. What GHOSTFACE is

GHOSTFACE is a free, publicly-available end-to-end encrypted messaging and calling app for iOS and Android, published by Ghostface Limited, a New Zealand company. Its cryptography serves one purpose: protecting users' personal communications in transit and at rest. See the accompanying **Cryptographic Inventory** for the full technical detail.

## 2. Why we are seeking advice

The app is distributed through Apple (US-based infrastructure) and is built on Expo's US-based build servers, so US Export Administration Regulations (EAR) exposure exists regardless of the company's New Zealand domicile. As a New Zealand exporter, we may also have obligations under New Zealand's strategic-goods controls (administered by MFAT). We want a defensible classification under both regimes **before** resuming distribution. Two builds were previously distributed via TestFlight, with Apple's export questionnaire answered, before we identified the specific question below; we then paused.

## 3. The cryptography, in brief

Every algorithm used is a standard published algorithm: ChaCha20-Poly1305 (RFC 8439), X25519 (RFC 7748), Ed25519 (RFC 8032), ML-KEM-768 (NIST FIPS 203), SHA-2 (FIPS 180-4), HKDF (RFC 5869), PBKDF2 (NIST SP 800-132), all via the open-source `@noble/*` libraries, over the OS-provided CSPRNG. The protocol is the publicly-documented Signal design (X3DH + Double Ratchet), extended to post-quantum using the same hybrid method Signal published as PQXDH and Apple published as iMessage PQ3.

## 4. The specific point we want tested

We believe GHOSTFACE is a **mass-market** product using **only standard cryptography**, which — as we understand it — would point toward mass-market treatment (US: ECCN 5D992.c self-classification under EAR §740.17; NZ: the Wassenaar "Cryptography Note" / mass-market exemption) rather than a formal review (US: a CCATS filing with BIS; NZ: an MFAT permit).

The one element that we want counsel to scrutinise is an internally-named function, **`kdfRkPQ`**. We flag it proactively because the name might suggest a proprietary algorithm. It is not. It is a single HKDF-HMAC-SHA256 (RFC 5869) invocation whose input is the concatenation of a standard X25519 Diffie-Hellman output and a standard ML-KEM-768 shared secret, with a domain-separation label. It introduces no new cryptographic primitive; it is the standard, published technique for combining a classical and a post-quantum secret, and is structurally the same as the continuous post-quantum rekeying in Apple's iMessage PQ3.

Our understanding is therefore that this does **not** constitute "non-standard" or "proprietary" cryptography in the sense that would force a formal classification, but we recognise this is a regulatory-interpretation question, not a technical one — which is why we are asking rather than self-classifying.

## 5. Questions for counsel

1. **US EAR:** Does GHOSTFACE qualify for mass-market self-classification (5D992.c under §740.17), or does any element — in particular the `kdfRkPQ` composition — require a CCATS classification request to BIS? Are there notification/self-classification report obligations we must meet either way?
2. **New Zealand:** Does the Wassenaar Cryptography Note / mass-market exemption cover export of this software from New Zealand, or is an MFAT strategic-goods permit required?
3. **Practically:** What is the lowest-friction compliant path to resume App Store / Play Store distribution, and are there records we should retain (e.g. the classification rationale, this inventory) to evidence compliance?

## 6. What we can provide

The full cryptographic inventory (attached), the relevant source files, the Apple export-questionnaire responses from the prior builds, and any additional technical detail on request. The author can answer technical questions on the crypto stack directly.

---

*Prepared by the company to assist counsel's assessment. Ghostface Limited is not qualified to make the export-control determination and is engaging counsel precisely to obtain it.*
