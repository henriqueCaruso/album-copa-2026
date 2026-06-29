# Security Specification - Álbum Copa 2026

## 1. Data Invariants
1. **User Identity Invariant**: A user can only create or update their own profile document (`users/{userId}` where `userId == request.auth.uid`).
2. **Album Ownership Invariant**: A user can only update their own album document (`albums/{userId}` where `userId == request.auth.uid`).
3. **Verified Signatures**: All writes must check that the requesting account has a verified session (`request.auth.token.email_verified == true` or at least `request.auth != null`).
4. **Immutable Fields**: Timestamps like `createdAt` and owner references like `userId` must remain unchanged after creation.
5. **Strict Schema Constraints**: Values such as `progressPercent` must be a valid number, and arrays like `ownedStickers` must stay within reasonable bounds.
6. **No Client Query Delegation**: List queries must be guarded so that players cannot scrape other players' personal logs or private data.

## 2. The "Dirty Dozen" Vulnerability Scenarios & Rejected Payloads

### Test Case 1: Shadow Update Profile (Injecting Admin Role)
- **Vulnerability**: Attacker attempts to set an `isAdmin` or `role` flag inside their user profile.
- **Payload**: `{ "uid": "ATTACKER_UID", "name": "Hacker", "email": "hacker@evil.com", "isAdmin": true }`
- **Result**: `PERMISSION_DENIED` - Schema validation rejects unlisted keys via `affectedKeys().hasOnly()`.

### Test Case 2: Spoofed Identity in User Profiles
- **Vulnerability**: Authenticated user `UID_A` attempts to write to `/users/UID_B`.
- **Payload**: `{ "uid": "UID_B", "name": "Imposter" }`
- **Result**: `PERMISSION_DENIED` - Match variable must equal `request.auth.uid`.

### Test Case 3: Identity Hijacking in Albums
- **Vulnerability**: Attacker attempts to modify another user's sticker list.
- **Payload**: Overwriting `albums/VICTIM_UID` with empty ownedStickers.
- **Result**: `PERMISSION_DENIED` - Write blocked unless user is the resource owner.

### Test Case 4: Invalid Types (Value Poisoning)
- **Vulnerability**: Attacker attempts to set `progressPercent` to a massive string instead of a number.
- **Payload**: `{ "userId": "UID_A", "progressPercent": "one_hundred_percent_hacked_string_of_huge_size" }`
- **Result**: `PERMISSION_DENIED` - Validation helper enforces `data.progressPercent is number`.

### Test Case 5: Temporal Tampering
- **Vulnerability**: Attacker submits a future timestamp in `lastUpdated` or a historical time in `createdAt`.
- **Payload**: `{ "userId": "UID_A", "lastUpdated": timestamp("2035-12-31T23:59:59Z") }`
- **Result**: `PERMISSION_DENIED` - Rules mandate equality with `request.time`.

### Test Case 6: Unbounded Array Allocation (Denial of Wallet)
- **Vulnerability**: Attacker attempts to submit an array with 100,000 garbage sticker identifiers to trigger memory exhaustion.
- **Payload**: `{ "ownedStickers": [ "FWC_1", ..., "100000_elements" ] }`
- **Result**: `PERMISSION_DENIED` - Size constraints enforced on arrays (`size() <= 1000`).

### Test Case 7: Resource ID Poisoning
- **Vulnerability**: Attacker tries to create a share document with a path variable containing 2KB of random non-alphanumeric characters.
- **Path**: `/trade_shares/$$$___HUGE_BAD_STRING_JUNK___$$$`
- **Result**: `PERMISSION_DENIED` - Document ID validation rejects non-matching alphanumeric strings.

### Test Case 8: Album Progress Out-of-Bounds
- **Vulnerability**: Attacker attempts to set a negative progress percentage.
- **Payload**: `{ "progressPercent": -50 }`
- **Result**: `PERMISSION_DENIED` - Validation helper requires `progressPercent >= 0` and `<= 100`.

### Test Case 9: Scraping Private Activity Logs (Client-Side Query Delegation Bypass)
- **Vulnerability**: Authenticated user attempts a blanket list query to download all user activity logs.
- **Operation**: `list /activity_logs`
- **Result**: `PERMISSION_DENIED` - List operation must be explicitly filtered by user's own UID.

### Test Case 10: Email Verification Spoofing
- **Vulnerability**: User with unverified email attempts to modify shared records when verification is strictly required.
- **Payload**: Authenticated with `email_verified: false`
- **Result**: `PERMISSION_DENIED` - Write rules require `request.auth.token.email_verified == true`.

### Test Case 11: Modifying Immutable Creator in Shares
- **Vulnerability**: User attempts to update a shared token's `userId` ownership to another account.
- **Payload**: Changing `userId` from `UID_A` to `UID_B` in `trade_shares/{shareId}`.
- **Result**: `PERMISSION_DENIED` - Immutable fields block updates to ownership properties.

### Test Case 12: Invalid Log Type Poisoning
- **Vulnerability**: Attacker writes a log with an unlisted category.
- **Payload**: `{ "userId": "UID_A", "type": "malicious_exploit", "description": "some text", "timestamp": request.time }`
- **Result**: `PERMISSION_DENIED` - Enforce enum validation.
