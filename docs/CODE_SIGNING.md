# Code signing and notarization

macOS **Gatekeeper** and Windows **SmartScreen** warn on apps that are not signed by a known publisher. CI builds are signed and notarized when the GitHub secrets below are set.

## macOS (required for a smooth install)

1. Enroll in the [Apple Developer Program](https://developer.apple.com/programs/) (Team ID required).
2. Create a **Developer ID Application** certificate, export as `.p12`.
3. Create an [app-specific password](https://appleid.apple.com) for notarization.
4. Add repository secrets on `vnetgrowth-telegram-session-loader`:

| Secret | Value |
|--------|--------|
| `MACOS_CERTIFICATE_BASE64` | Base64 of the `.p12` file |
| `MACOS_CERTIFICATE_PASSWORD` | Export password for the `.p12` |
| `APPLE_NOTARIZE_EMAIL` | Apple ID email |
| `APPLE_NOTARIZE_APP_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | 10-character Team ID |

5. Tag a release (`v*`). The macOS job sets `CSC_LINK`, `CSC_KEY_PASSWORD`, and Apple notarize env vars for `electron-builder`.

Without these secrets, macOS builds are **unsigned**. Users can still install via **Right-click > Open** or **System Settings > Privacy & Security > Open Anyway**.

## Windows (recommended)

1. Obtain an **Authenticode** code signing certificate (EV certs reduce SmartScreen warnings faster).
2. Export as `.p12` and add:

| Secret | Value |
|--------|--------|
| `WINDOWS_CERTIFICATE_BASE64` | Base64 of the signing `.p12` |
| `WINDOWS_CERTIFICATE_PASSWORD` | Export password |

If unset, the `.exe` installs but SmartScreen may show **Windows protected your PC** until users choose **More info > Run anyway**.

## Local signed build (macOS)

```bash
export CSC_LINK=/path/to/DeveloperID.p12
export CSC_KEY_PASSWORD='...'
export APPLE_ID='...'
export APPLE_APP_SPECIFIC_PASSWORD='...'
export APPLE_TEAM_ID='...'
npm run dist:mac
```
