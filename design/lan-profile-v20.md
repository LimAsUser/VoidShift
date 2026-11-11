# V20 LAN personal profiles

Online, localhost and LAN addresses keep independent browser profiles. Scheme,
hostname/IP and port are part of the origin: changing any of them selects a
different save. LAN never uploads personal assets to the host or the online DB.
Use export/import when intentionally moving a profile between these addresses.
Import replaces the destination profile; it does not merge balances or items.

## Transfer controls

Export from the source game's safehouse, then open the destination and import
the JSON file. Finish tasks, leave co-op rooms and let pending rewards settle
first. Close every other game tab using the destination address before import
or backup restoration. Ordinary gameplay saves intentionally retain their
existing behavior; another active tab can overwrite a replaced asset snapshot.
The UI repeats this instruction before replacement. Import/restoration reloads
the page immediately so runtime inventory matches the replaced profile.

The format is `voidshift-profile`, version `1`, at most 2 MiB in UTF-8. It carries
the validated balance, weapon ownership/loadout/ammunition, backpack, warehouse,
overflow, warehouse capacity, mission/defeat history, advanced unlock, daily date,
applied receipt IDs/expiries and accumulated reward credits. Existing saved
difficulty selections/profiles and user preferences are also whitelisted.

Once-only markers travel unchanged: `flashbangInventoryVersion`,
`skillInventoryMigrationVersion`, `starterGrantVersion`, `balanceVersion`,
`enemyCountMigrationVersion`, and `playerFeedbackMigrationVersion`. Required
markers cannot be missing or null in an imported v1 file. This preserves the
source profile's existing supply grants, refunds and migrations.

Room IDs and member/host tokens are not transferred. Pending reward claim/report
credentials, local receipt outboxes and LAN reconnect credentials are not
transferred. Finished registered mission metadata can remain on its original
origin, but transfer is blocked while an unregistered mission, claim, report or
unapplied local receipt is pending. Unknown fields are discarded through the
whitelist; invalid known fields, item IDs/shapes/placement, equipment choices,
money/ammo/counts, dates and unsupported versions are rejected before mutation.

## Backups and reward consistency

Export uses the journal-merged current save. Import replaces both
`voidshift_save` and `voidshift_reward_ledger` together within the save mutex.
Replacing only the asset snapshot would allow an old reward journal to add old
credits again. Imported totals, daily markers, receipt markers and statistics
become the new journal, with no merge against the destination's history.

Before replacement, the exact two previous snapshots are stored in
`voidshift_profile_backup_v1`. A backup failure leaves both current snapshots
untouched. A failed replacement tries to restore both previous snapshots. If
storage also prevents rollback, the persisted backup remains available for
manual recovery after browser storage access is restored. A failed backup
restoration retains its original target for retry. A successful restore swaps
the backup with the profile it replaced, so the operation can be reversed.
This is a browser-local recovery path, not a server account backup or a merge.

## Save mutex

`SaveRewards.locked(action)` uses Web Locks whenever available. On HTTP LAN
origins without Web Locks, it waits for `LANRuntime.ready`, then requires the
verified V20 LAN bootstrap (`mode: 'lan'`, `verified: true`, protocol version 20,
transport `LAN_WS_V20`, four-player capacity). It opens the origin-local
`voidshift-save-lock-v1` IndexedDB database and uses a `readwrite` transaction
over its `mutex` store. The synchronous localStorage action runs inside the
request's success event, while the transaction exclusively owns that store.
The [IndexedDB transaction scheduling specification](https://w3c.github.io/IndexedDB/#transaction-scheduling)
defines the exclusive ordering for overlapping readwrite transactions.

Async callbacks/thenable results are rejected. Network requests must run before
or after the mutex, never within it. IndexedDB denial, open blocking, request
failure or an unverified origin fails closed. No localStorage lease or timeout
lock is used. This mutex serializes reward/profile transactions across tabs; it
does not redesign unrelated ordinary gameplay saves.

## Frontend API and focused verification

`globalThis.SaveProfile.canTransfer(game)` returns a boolean for current idle
state and reward work. `export(game)` resolves to serialized JSON.
`import(serialized, game)` and `restoreBackup(game)` resolve to
`{ reloadRequired: true }`; callers must reload immediately. All mutations
repeat the idle guard after obtaining the same reward mutex.

`node --test tests/lan-save-profile-v20.test.cjs tests/player-rewards.test.cjs tests/v17-profile.test.cjs`
checks distinct-tab queued IndexedDB transactions, one daily grant, one credit
for repeated receipts, bootstrap/storage/async rejection, whitelist/schema/item
validation, exact journal replacement, pending-task guards, backups and failed
write/restore recovery. The IndexedDB fixture models queued connections and
active request events; it is not a claim of browser, firewall, VPN or multi-PC
acceptance testing. No project-wide build/lint/test command is required here.
