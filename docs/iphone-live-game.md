# Live game on the iPhone

The iPhone widgets (`apps/ios/DeepARAMWidgets`) and the Live Activity show the owner's live Mayhem game. The owner's
PC app is the source: it already reads the game (League's Live Client Data API) for the overlay and companion. Owner
only: nothing here is public, and the win chance is the owner's own predicted line, as in the PC app.

```
PC app ──POST /api/widget/live──▶ deeparam.com ◀──POST /api/widget/push── iPhone app (push tokens)
   │        (answer: phone's push tokens)               │
   └────────── HTTPS/2 push ──▶ Apple (APNs) ──▶ Live Activity     GET /api/widget ◀── widgets (every ~1 min in game)
```

The PC app sends the pushes to Apple itself because Apple's push service needs HTTP/2, which a Cloudflare Worker's
`fetch` doesn't speak. The Apple key stays on the PC.

## 1. Report the game: `POST https://deeparam.com/api/widget/live`

```json
{ "token": "<Riot Client token, as sent to /api/history>", "platform": "na1",
  "live": { "champion": "Wukong", "championId": "MonkeyKing", "startedAt": 1763690000000, "level": 11,
            "kills": 6, "deaths": 3, "assists": 14, "nextAugment": 11, "augmentReady": true,
            "nextItems": ["Sterak's Gage", "Death's Dance"], "winChance": 0.61, "dead": false } }
```

- Every 5 to 15 seconds during a Mayhem game; `"live": null` once when it ends. 90 seconds of silence counts as ended.
- `startedAt` = now minus the Live Client's `gameData.gameTime`, in ms. The phone ticks the clock itself.
- `nextAugment`: the next of 1, 7, 11, 15 (null after 15). `nextItems`: at most 2 names. `winChance`: 0-1 or null.
- Only the owner's connected Riot account is accepted. Rate limit: 60 per minute.
- The answer: `{"ok": true, "push": {"start": {"token": "<hex>", "sandbox": false}, "activity": {...}}}`.
  `start` is the phone's push-to-start token, and `activity` is the running Live Activity's token, once one exists.

## 2. Push to the Live Activity (APNs)

One-time setup (Nico): developer.apple.com > Certificates, IDs & Profiles > Keys > + > Apple Push Notifications
service (APNs). Download the `.p8` once and note its Key ID and the Team ID. Keep them on the PC only.

- Host: `api.push.apple.com`, or `api.sandbox.push.apple.com` when the token's `sandbox` is true (an Xcode build).
- `POST /3/device/<token>` over HTTP/2, with headers `apns-push-type: liveactivity`,
  `apns-topic: com.deeparam.app.push-type.liveactivity`, `apns-priority: 10` (5 for routine updates),
  `authorization: bearer <JWT>`. The JWT is ES256 with header `{alg: ES256, kid: <Key ID>}` and claims
  `{iss: <Team ID>, iat: <now, seconds>}`. Reuse it for up to 50 minutes.
- **Start** (game began, no `activity` token yet, sent to the `start` token):
  `{"aps": {"timestamp": <s>, "event": "start", "attributes-type": "LiveGameAttributes", "attributes": {"champion": "Wukong"},
  "content-state": <live>, "alert": {"title": "In game", "body": "Wukong"}}}`
- **Update** (to the `activity` token; only when something shown changes: level, K/D/A, augment ready, dead, next items,
  win chance by 5 points or more; the clock ticks on its own):
  `{"aps": {"timestamp": <s>, "event": "update", "content-state": <live>}}`. Use priority 10 only for an augment pick
  or a death. Otherwise use 5, because Apple limits priority-10 pushes.
- **End**: `{"aps": {"timestamp": <s>, "event": "end", "content-state": <last live>, "dismissal-date": <s + 300>}}`.
- `content-state` has exactly the `live` fields above (`LiveGame` in `apps/shared/DeepARAMKit/.../LiveGame.swift`).

## 3. Phone side

More > iPhone widgets > Connect. The app then registers its push tokens whenever it opens. The phone needs Live
Activities on (Settings > DeepARAM). On a stand, StandBy shows the Live Activity full screen.
