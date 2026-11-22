#!/bin/bash
# GardenSower APK build. Local pipeline, same as MotorLedger/Cosmos 90GT.
set -e
export PATH=/workspace/toolchain/jdk/bin:$PATH
BT=/workspace/toolchain/bt
AJ=/workspace/toolchain/platform/android-34/android.jar
cd "$(dirname "$0")"
rm -rf classes dex unsigned.apk aligned.apk out.apk GardenSower_v*.apk
$BT/aapt2 compile --dir res -o res.zip
$BT/aapt2 link -o unsigned.apk -I $AJ res.zip --manifest AndroidManifest.xml \
  --min-sdk-version 21 --target-sdk-version 34 --version-code 1 --version-name 0.1 -A assets
javac -source 1.8 -target 1.8 -classpath $AJ -d classes src/au/com/jmarrone/gardensower/*.java
mkdir -p dex
$BT/d8 --release --min-api 21 --lib $AJ --output dex $(find classes -name "*.class")
python3 - <<'PY2'
import zipfile
src = zipfile.ZipFile('unsigned.apk')
out = zipfile.ZipFile('out.apk', 'w', zipfile.ZIP_DEFLATED)
for n in src.namelist():
    # resources.arsc must be STORED (uncompressed) and aligned for targetSdk 30+
    if n == 'resources.arsc':
        out.writestr(zipfile.ZipInfo(n), src.read(n))
    else:
        out.writestr(n, src.read(n))
out.write('dex/classes.dex', 'classes.dex')
out.close()
print('packaged')
PY2
$BT/zipalign -f 4 out.apk aligned.apk
if [ ! -f gardensower.keystore ]; then
  keytool -genkeypair -keystore gardensower.keystore -alias gardensower -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$KEYSTORE_PASS" -keypass "$KEYSTORE_PASS" -dname "CN=GardenSower, O=JMarrone, L=Hobart, ST=TAS, C=AU"
fi
if [ -z "$KEYSTORE_PASS" ]; then echo "Set KEYSTORE_PASS (the signing password; held outside the repo)." >&2; exit 1; fi
$BT/apksigner sign --ks gardensower.keystore --ks-pass pass:"$KEYSTORE_PASS" --out GardenSower_v0.1.apk aligned.apk
$BT/apksigner verify --print-certs GardenSower_v0.1.apk
ls -la GardenSower_v0.1.apk
