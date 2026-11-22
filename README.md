# GardenSower

An offline garden log for Android: plants, beds, and dated entries with photos.
Snap or pick a photo, pick a crop, and the care timeline builds itself from a
bundled crop database. No sensors, no accounts, no cloud.

## What it does

- **Photo-first logging.** Every plant starts with a photo. Waterings, feeds,
  pruning, treatments and harvests are two-tap entries with an optional photo.
- **The timeline builds itself.** From the sowing date and the bundled temperate
  crop database (42 crops), the app estimates germination, first harvest and
  watering intervals. Every estimate is framed as an estimate: "expected about
  14 Feb", and logging the real event replaces it.
- **Southern hemisphere by default.** Sowing windows ship for temperate
  southern Australia (Hobart-correct); northern users get the mirrored set.
  Hemisphere comes from a **one-time** coarse location check at first run, then
  the permission is never used again. No continuous tracking.
- **Watering sense.** The Today screen groups plants into needs water / coming
  up / on track, and an optional rain check (Open-Meteo, opt-in in Settings)
  softens watering nudges after real or forecast rain. Everything else stays
  fully offline, and the app never waits on the weather layer.
- **Your data stays yours.** Everything lives on the phone. One-tap export of
  the whole log as JSON to Downloads/GardenSower; camera originals are written
  to the phone gallery under Pictures/GardenSower, so nothing is lost if the
  app is uninstalled. Thumbnails stay in-app to keep the store small.

## Build

Same local pipeline as the author's other apps (aapt2 + d8 + apksigner):

```bash
cd android && ./build.sh
```

Requires the Android build tools under `/workspace/toolchain`. Output:
`GardenSower_v0.1.apk` (minSdk 21, targetSdk 34), signed with a keystore held
outside the repo.

## Privacy

- No account, no analytics, no third-party SDKs.
- Location: one coarse fix at first run to set hemisphere/climate; never used again.
- Network: used only if you turn on the optional weather check.

## License

MIT
