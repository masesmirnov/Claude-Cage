# Setting the name and devices when creating a guest

In the "System and storage" step of first setup, expand "Guest name and initial device settings". You can fill them in or leave them empty for Cage to generate random values; "Generate new random name and size" previews a new set of values. The preview does not create a disk or save an environment identity.

When installation starts, the settings are saved to `guest-profile.json` in the current separate config folder. Continuing an interrupted installation, restarting, reconnecting and updating components all reuse it. After installation has started, first setup cannot replace these values, so that accounts, file permissions, SSH and browser data keep matching. Create a separate new environment if you need another identity.

## Settings

| Setting | Default | Manual value and scope |
| --- | --- | --- |
| Host name | Randomly generated from a short real PC model name or a common PC naming style | 1–15 ASCII letters, digits and hyphens; starts with a letter and ends with a letter or digit. Applies to new Linux, macOS and Windows guests |
| Linux work account | A common first name plus two digits, such as `alex73` | 1–24 lowercase letters, digits and underscores, starting with a letter; system accounts are not used |
| Linux browser account | Another separate random account | Same as above; must differ from the work account to keep the permission boundary between the two |
| Two Linux home folders | `/home/<account>` each | Each can be set to its own single-level folder under `/home/`; the name starts with a letter, is at most 63 characters and contains only ASCII letters, digits, dots, hyphens and underscores. They cannot share a folder or use the `cage` and `cage-browser` folders reserved by the base image |
| Linux audio device | Chosen automatically from 12 real USB audio product models | The model description matches the device name, and the device name gets its own random suffix; first setup needs no manual input. Existing custom audio settings are kept |
| Linux virtual display | Chosen at random from 1920×1080, 1920×1200, 2560×1440, 2560×1600, 2880×1800 and 3840×2160 | Width 800–3840 and height 600–2160, entered together |
| Initial browser window | Chosen at random from common window sizes that fit the display size | Same as above; on Linux the initial window cannot be larger than the virtual display. The actual workbench viewport, full screen, pixel density and later user changes still affect the final visible size |
| Linux control extension name | Chosen at random from ordinary tab/window management names | 1–64 plain ASCII characters; the extension install path and the extension ID derived from it are also randomized per environment |
| WebGL | Native behavior | You can turn off web 3D graphics; Linux Chromium, Windows Chromium and macOS Chrome apply it when the process starts |
| Canvas image reading | Native behavior | You can block web pages from reading Canvas images, covering regular and authorization windows of the same browser process |
| Browser graphics backend | Uses the devices available in the guest automatically | Choose ANGLE's Metal, D3D11, Vulkan or OpenGL by guest system, or the SwiftShader software compatibility mode |
| Linux QEMU virtual GPU | Keeps the existing device | Linux hosts can choose the experimental VirGL + DRI3, which needs a host GPU, a QEMU with OpenGL support and a TigerVNC that supports `-rendernode`; containers don't offer this option |

Names, device descriptions and extension names do not accept control characters, quotes or script fragments. Sizes have clear limits. These settings cannot inject arbitrary browser arguments, change the proxy, turn off the sandbox or open a debugging port.

Choose names that are natural, easy to remember and different from your previous environment identities. Accounts, device names and sizes form one persistent configuration; they are not drawn again when the same environment restarts or reconnects.

The audio library is embedded in the program and contains 12 products from the Focusrite Scarlett 4th gen, Behringer U-PHORIA UMC202HD, Steinberg UR-C and Yamaha AG MK2 lines, with source links saved with the records in `internal/guestprofile/audio-models.json`. These names are naming material for the Linux virtual output; they do not turn the null output device into an actual USB sound card, and do not fake a USB VID/PID or physical device serial number. Native macOS and Windows audio still uses the devices reported by their actual drivers.

## Platform behavior

On Linux, the account settings apply to Lima initialization, the first container start, service accounts, sudo rules, the browser home folder, audio capture and attachment path checks. The work/browser roles in the clipboard protocol and internal service names stay stable; they are not used as actual Linux login names. When a container renames the image's initial accounts, it only touches this environment's file system and verifies the work account's UID and the browser account's separation.

When Lima derives a work instance from the base template, it uses the host name and accounts already chosen for this environment, while the UUID and MAC are still generated separately. Regular Lima clones without Cage creation settings keep the old random host name behavior.

A regular Windows installation writes the chosen host name into the new system's answer file. When running `new-windows-test-vm.ps1` or `start-windows-evaluation-setup.ps1` on its own, you can set it with `-ComputerName MY-PC`; without it `*` is used and Windows Setup generates the name. Imported existing Windows systems are not renamed, and the host Windows computer name is not changed.

macOS Chrome and Windows browsers save this guest user's public browser creation settings. They apply to newly started browser processes; existing windows are not closed just because of a reconnect. A manual macOS host name is still applied through Lima's guest initialization config.

Old environments without `guest-profile.json` keep their existing account and device settings. A damaged or incomplete config file, or one with unknown fields, reports an error and does not replace existing accounts or disks automatically.

## What the graphics options mean

The `Apple Paravirtual device` name of the virtual GPU comes from the actual graphics driver. ANGLE's Metal backend changes the browser's graphics API path; it cannot remove Apple Virtualization's virtual device and does not mean physical GPU passthrough. Windows D3D11 and Linux OpenGL/Vulkan likewise depend on the drivers actually available in the guest. SwiftShader is offered explicitly as a software mode, and the checks tell software fallback apart from a virtual GPU.

When Metal, D3D11, Vulkan or OpenGL is chosen, the browser requests the selected backend and asks for zero-copy uploads with `--enable-zero-copy`. Chromium decides whether to use GPU rasterization based on driver capabilities and its compatibility block list, and Canvas 2D acceleration also depends on how the page draws. Automatic mode and SwiftShader keep their default upload methods.

| Guest | Browser backends |
| --- | --- |
| macOS | Automatic, Metal, OpenGL, SwiftShader |
| Windows | Automatic, D3D11, OpenGL, SwiftShader |
| Linux | Automatic, Vulkan, OpenGL, SwiftShader |

New Linux virtual machines on Linux hosts can also choose VirGL: it uses QEMU `egl-headless` and the accelerated virtio GPU, and the guest provides OpenGL rendering through Mesa and TigerVNC's DRI3 render node. Before creation it checks that the current user can open the host DRM render node; during provisioning it checks the guest's `/dev/dri/renderD128`, VNC argument support and the browser account's access, and fails clearly if something is missing. It does not change host drivers, device permissions or the firewall. This path is not connected to Venus/Gfxstream and cannot be combined with the Vulkan option. The driver still reports VirGL; this is not an implementation that picks a physical GPU from a graphics card library.

The browser keeps the native UA and Client Hints of the actually installed version, and does not assemble a random browser version, operating system or graphics card model. Desktop browser UAs usually do not include the physical motherboard model, and changing the string cannot provide rendering behavior consistent with that hardware.

Turning off WebGL uses Chromium's own `--disable-3d-apis` and `--disable-webgl`; blocking Canvas reading uses `--disable-reading-from-canvas`. These options control browser capabilities and do not add random noise to images.

Sites that rely on 3D rendering, image editing, Canvas export or CAPTCHAs may be affected, so both options keep native behavior by default. Turning a feature off can itself be observed by web pages. Other browsers, apps, kernels, fonts, GPUs, software versions and Cage's internal services may still share common traits; these settings do not guarantee that the environment cannot be recognized.

The controlled network, sandbox and management arguments the browser needs are still managed by Cage. Differences in these arguments come from the graphics capabilities, window size and separate extension the user chose, not from pointlessly shuffling the order of launch arguments.

## Check what actually took effect

After the environment starts, click "Check browser" or "Check Claude Desktop" in the safety check panel; the Desktop toolbar also offers "Check environment".

- The browser checks, in a local diagnostic page, the major version and platform of the UA and Client Hints, display information, the checksum of known Canvas colors and font samples, WebGL shader compilation and reference pixels, and tells software rendering, a virtual GPU and the driver-reported renderer apart.
- On Linux it also checks the actual host name, work account, home folder and audio output description. Browser audio labels are limited by permissions; the check does not ask for microphone permission and shows "Not observed" when labels are missing. The diagnostic page viewport is not the user's current window size and is not used to verify the initial window size.
- Claude Desktop checks the available installation, version and running state, and the Linux system configuration. The official app has no supported in-app rendering self-check, so its internal renderer is shown explicitly as "Not observed"; browser probe results are not used as evidence about Desktop internals.

The checks do not read sign-in data, device IDs or serial numbers, do not inject code into Desktop or open a debugging port, and do not run external fingerprint lookups. The results help find configuration mismatches, rendering errors and software fallback; they do not certify a "real physical device" or anonymity. An identical Canvas checksum alone is not counted as a failure.

VirGL, macOS Metal and Windows D3D11 still need acceptance by actually starting a guest on the matching platform; the Linux development machine used this time did not complete end-to-end verification of these hardware paths.

References: [QEMU virtio-gpu backends](https://www.qemu.org/docs/master/system/devices/virtio/virtio-gpu.html), [TigerVNC rendernode](https://github.com/TigerVNC/tigervnc/blob/master/unix/xserver/hw/vnc/Xvnc.man), [official Chromium switch definitions](https://chromium.googlesource.com/chromium/src/+/HEAD/content/public/common/content_switches.cc), [Windows ComputerName](https://learn.microsoft.com/en-us/windows-hardware/customize/desktop/unattend/microsoft-windows-shell-setup-computername), [machine identity](guest-identity.md).
