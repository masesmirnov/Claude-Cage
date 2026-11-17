# Machine identity of new environments

When creating a new environment, Cage uses `crypto/rand` to generate random values for these identifiers:

| Identifier | Linux container | Lima / QEMU | Lima / Apple Virtualization |
| --- | --- | --- | --- |
| Guest host name | Common PC naming style or short real model name + random suffix, at most 15 characters | Same | Same, applied by the guest initialization config |
| UUID | Generated separately for each container | Passed to QEMU with `-uuid` | The platform identifier is still generated and persisted by the Apple framework |
| `/etc/machine-id` | On the first start of a blank image, systemd initializes it with `container_uuid` | The existing machine-id on the disk is not changed | Not applicable to macOS; the existing machine-id on Linux disks is not changed |
| Default guest NIC MAC | Random locally administered unicast address | Same, the guest config and DHCP lease stay in sync | Same |
| Gateway MAC of the separate virtual network | Separate random locally administered unicast address | Same | Same |

During first setup you can enter the host name by hand, or leave it empty to generate a random one. The Linux accounts, home folders, initial size, control extension and browser graphics backend can also be set at creation, and the audio output name is chosen automatically from a library of real product models; see [guest creation settings](guest-profile.md). The browser keeps its actual UA and Client Hints; the settings are saved with the environment and are not drawn again on restart. The environment checks can compare the settings with the actual rendering capabilities; hardware or app internals that were not observed are not marked as passed.

New Windows installations use the chosen computer name; when running the PowerShell creation script for the retail or evaluation edition on its own, you can set it with `-ComputerName`, and without it `*` is used and Windows Setup generates one. Existing Windows systems imported by the user are not renamed. The hardware identifiers of native Windows Hyper-V are still managed by Hyper-V.

Host names have no fixed `claude-cage-`, `cage-` or `lima-` prefix and contain no project folder, host machine name or path hash. The first byte of the MAC only keeps the locally administered unicast bit constraint and uses no fixed three-byte prefix.

## Host name rules

Each creation picks one of five equally likely style slots:

| Slot | Rule | Example (shows the format, not a real device name) |
| --- | --- | --- |
| 1 | `DESKTOP-` + 7 random uppercase letters/digits | `DESKTOP-7Q4N8K2` |
| 2 | `LAPTOP-` + 7 random uppercase letters/digits | `LAPTOP-H8D2M6R` |
| 3, 4 | Short name of a real desktop/laptop/workstation model + 6 or 7 random letters/digits | `LAT5450-A7K2M9`, `t14g4-3n8q6x` |
| 5 | Short name of a real motherboard model + 6 or 7 random letters/digits | `B860MSL-K7R2M9` |

Hardware model styles also pick uppercase or lowercase at random. Short names are at most 7 characters; all names use ASCII letters, digits and single hyphens, with a full length of at most 15 characters. Style, model, case and suffix all use `crypto/rand`, and the selection uses rejection sampling, without simple modulo bias. The length varies with the short model name and the suffix, and is no longer always 12 lowercase letters.

The offline library has **1,593 real model records and 1,181 distinct short names**: 506 Lenovo, 499 Dell, 551 HP and 37 ASRock motherboard records. The records come from the vendors' public model and driver deployment catalogs and keep the full model, vendor and source checksum. `Type` model variants in the Lenovo catalog stay in the original model column; generating short names drops these trailing SKU fields to keep the more recognizable model and generation.

Short names are naming material this project derived from real models. They do not claim to be factory host names, and do not stand for actual SMBIOS, motherboards, CPUs or guest systems. The Windows default `DESKTOP-` form can also appear on laptops; these weights mix styles and do not represent market share. Linux containers and Lima guests share this generator; native Windows installations still use Setup's own naming rules.

The data is embedded in the program; creation does not go online, query host hardware or install drivers. For how it is updated and where it comes from, see `docs/hostname-catalog.md`, `hostname-sources.json` and `scripts/update-hostname-catalog.py`. The script only compiles data from local XML/JSON, and its output is reproducible.

## Lifecycle

- **New**: a new identity is generated each time an environment is actually created. Containers store it in their own `cn.cage.guest-identity` label; Lima stores it in the `guestIdentity` field of the instance's `lima.yaml`.
- **Reconnect, restart, resource changes**: the existing identity is reused, so that DHCP, system services and persistent data are not affected by needless changes.
- **Clone**: the target instance gets a new UUID and MAC, including clones of old templates without the `guestIdentity` field. Work instances derived inside a Cage environment use the chosen host name; regular clones without Cage creation settings still get a new host name. The source instance stays as it is.
- **Old environments**: instances without an identity field or label keep the old behavior; they are not rebuilt, renamed or wiped automatically. Create a new environment when you need a new identity.
- **Bad data**: an existing identity field with an invalid format returns an error and does not fall back to a shared fixed value. Creation stops if the random source fails.

The Linux container base image must keep `/etc/machine-id` empty and must not keep a separate D-Bus machine-id; the repository's image build script already checks the identity cleanup. `container_uuid` only applies to a new container's first start and does not overwrite a machine identity the user changed later.

## Scope and verification

These changes reduce fixed identity fields that could link environments, and do not guarantee that an environment cannot be recognized. The operating system and kernel, virtual device models, CPU features, software versions, account names, Cage services and file paths, network topology and browser fingerprint can still reveal the runtime environment. Resource quotas, system language, time zone and user preferences keep their configured meaning. This change does not reset the existing machine-id, SSH host keys and app data on a cloned Lima disk; for a generic system image, build a template following that system's practices first.

Local unit tests cover the hardware library size and checksum, all naming styles, name length and case changes, invalid catalog data, identity randomness and format, entropy source failure, saving and reading back the configuration, compatibility with old configurations, and ARP and the network-off gate with a random MAC. The Lima lifecycle tests need the packaged guest agent and template; full startup verification also needs each platform's runtime environment.

For manual acceptance, check the host name, default NIC MAC and gateway neighbor entry in two brand-new environments; for Linux containers also check `/etc/machine-id`. Repeat the checks after fully stopping and starting the same environment to confirm the identity is stable. Do not attach credential files, private keys or raw logs to issues or test reports.

References: [systemd container interface](https://systemd.io/CONTAINER_INTERFACE/), [Windows ComputerName](https://learn.microsoft.com/en-us/windows-hardware/customize/desktop/unattend/microsoft-windows-shell-setup-computername).
