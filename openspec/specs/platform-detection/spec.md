# platform-detection Specification

## Purpose
Provides dynamic discovery of host operating systems, Linux distribution families, CPU architectures, display server environments, and virtualization boundaries.

## Requirements

### Requirement: Operating System and Linux Distribution Identification
The system SHALL identify the host operating system family and Linux distribution by inspecting system release metadata.

#### Scenario: Detecting Linux distribution family
- **WHEN** client queries system environment on Linux
- **THEN** system parses `/etc/os-release` and classifies the distribution family as Fedora, Debian, Ubuntu, Arch, Alpine, openSUSE, or NixOS

#### Scenario: Detecting macOS environment
- **WHEN** client queries system environment on Darwin
- **THEN** system identifies macOS and detects whether running on Apple Silicon (`arm64`) or Intel (`x86_64`)

#### Scenario: Detecting Windows environment
- **WHEN** client queries system environment on Windows
- **THEN** system identifies win32 and resolves standard `%LOCALAPPDATA%` and `%PROGRAMFILES%` paths

### Requirement: WSL2 Virtualization and Gateway Resolution
The system SHALL detect Windows Subsystem for Linux (WSL2) environments and extract the host network gateway address.

#### Scenario: Detecting WSL2 kernel
- **WHEN** system inspects `/proc/version` on Linux and finds `microsoft` or `WSL`
- **THEN** system flags the virtualization mode as `wsl2`

#### Scenario: Resolving Windows host gateway IP
- **WHEN** running in WSL2 NAT mode and local loopback fails
- **THEN** system extracts the default network gateway IP address from the routing table

### Requirement: Cross-Architecture Browser Binary Locating
The system SHALL locate browser executables across heterogeneous CPU architectures and packaging sandboxes.

#### Scenario: Prioritizing Chromium on Linux ARM64
- **WHEN** binary search is performed on Linux `aarch64` where official Google Chrome is absent
- **THEN** system prioritizes native `chromium`, `chromium-browser`, and `brave-browser` binaries

#### Scenario: Resolving Ubuntu Snap and Flatpak binaries
- **WHEN** standard `/usr/bin` binaries are missing but Flatpak or Snap packages are installed
- **THEN** system locates the respective sandboxed launcher paths without failing

### Requirement: C Standard Library (Libc) Variant Resolution
The system SHALL identify whether the host Linux system is running GNU C Library (glibc) or musl libc.

#### Scenario: Detecting Alpine Linux musl libc
- **WHEN** system checks `/etc/alpine-release` or executes `ldd --version` detecting musl
- **THEN** system flags the C library runtime as `musl`

#### Scenario: Detecting standard glibc
- **WHEN** running on standard Debian, Ubuntu, Fedora, or Arch Linux
- **THEN** system flags the C library runtime as `glibc`

### Requirement: Shell Profile and PATH Configuration
The system SHALL detect user shell configurations and format binary search paths appropriately.

#### Scenario: Auto-detecting active user shell configuration
- **WHEN** bootstrap installer inspects `$SHELL`
- **THEN** system identifies `.bashrc`, `.zshrc`, or `config.fish` and offers non-destructive PATH export
