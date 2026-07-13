#!/usr/bin/env bash
# Glitch AI Installer for macOS/Linux (POSIX-compatible)
# Standalone installer - download and run directly from GitHub.
#
# Usage:
#   curl -sL https://raw.githubusercontent.com/Cothek/glitch-ai/main/scripts/install.sh | bash
#   wget -qO- https://raw.githubusercontent.com/Cothek/glitch-ai/main/scripts/install.sh | bash
#   bash install.sh [install_dir] [--no-launch]

set -euo pipefail

# Default values
INSTALL_DIR="${1:-$HOME/glitch-ai}"
NO_LAUNCH=false

# Parse arguments
for arg in "$@"; do
    case "$arg" in
        --no-launch) NO_LAUNCH=true ;;
        --help|-h)
            cat <<'EOF'
Glitch AI Installer for macOS/Linux

Usage:
  curl -sL https://raw.githubusercontent.com/Cothek/glitch-ai/main/scripts/install.sh | bash [install_dir] [--no-launch]
  wget -qO- https://raw.githubusercontent.com/Cothek/glitch-ai/main/scripts/install.sh | bash [install_dir] [--no-launch]

Arguments:
  install_dir    Custom install directory (default: $HOME/glitch-ai)
  --no-launch    Skip launch prompt after installation
  --help, -h     Show this help

Prerequisites:
  - git
  - curl or wget
  - Internet connection

Node.js is NOT required - the launch scripts handle everything.
EOF
            exit 0
            ;;
        *) ;; # ignore unknown args (first positional is install_dir)
    esac
done

# Color codes (ANSI)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

# Output helpers
header() { printf "\n${MAGENTA}%s${NC}\n" "$1"; }
step()   { printf "  ${CYAN}%s${NC}\n" "$1"; }
success(){ printf "  ${GREEN}%s${NC}\n" "$1"; }
warn()   { printf "  ${YELLOW}%s${NC}\n" "$1"; }
error()  { printf "  ${RED}%s${NC}\n" "$1" >&2; }
prompt() { printf "  ${CYAN}%s${NC}" "$1"; }

# Banner
cat <<'EOF'
╔═══════════════════════════════════════════════════════════════════════════════╗
║                         GLITCH AI INSTALLER (macOS/Linux)                    ║
║                    Personal AI Companion - Persistent Memory                 ║
╚══════════════════════════════════════════════════════════════════════════════╝
EOF

# 1. Check prerequisites
header "Checking prerequisites..."

# Check git — auto-install via package manager if missing
if ! command -v git >/dev/null 2>&1; then
    warn "Git not found in PATH."

    # macOS — Homebrew
    if command -v brew >/dev/null 2>&1; then
        prompt "Install git via Homebrew? (Y/n): "
        read -r answer
        if [ -z "$answer" ] || echo "$answer" | grep -qi "^y"; then
            step "Installing git via Homebrew..."
            brew install git
            success "Git installed: $(command -v git)"
        else
            error "Install git manually: brew install git"
            exit 1
        fi

    # Debian/Ubuntu — apt
    elif command -v apt-get >/dev/null 2>&1; then
        prompt "Install git via apt (requires sudo)? (Y/n): "
        read -r answer
        if [ -z "$answer" ] || echo "$answer" | grep -qi "^y"; then
            step "Installing git via apt..."
            sudo apt-get install -y git
            success "Git installed: $(command -v git)"
        else
            error "Install git manually: sudo apt-get install git"
            exit 1
        fi

    # Fedora/RHEL — dnf
    elif command -v dnf >/dev/null 2>&1; then
        prompt "Install git via dnf (requires sudo)? (Y/n): "
        read -r answer
        if [ -z "$answer" ] || echo "$answer" | grep -qi "^y"; then
            step "Installing git via dnf..."
            sudo dnf install -y git
            success "Git installed: $(command -v git)"
        else
            error "Install git manually: sudo dnf install git"
            exit 1
        fi

    # Alpine — apk
    elif command -v apk >/dev/null 2>&1; then
        prompt "Install git via apk (requires sudo)? (Y/n): "
        read -r answer
        if [ -z "$answer" ] || echo "$answer" | grep -qi "^y"; then
            step "Installing git via apk..."
            sudo apk add git
            success "Git installed: $(command -v git)"
        else
            error "Install git manually: sudo apk add git"
            exit 1
        fi

    # Unknown package manager
    else
        error "No known package manager found."
        error "Install git manually, then re-run this script."
        error "  macOS: brew install git"
        error "  Debian/Ubuntu: sudo apt-get install git"
        error "  Fedora: sudo dnf install git"
        error "  Alpine: sudo apk add git"
        exit 1
    fi

    # Verify git is now available
    if ! command -v git >/dev/null 2>&1; then
        error "Git installation failed."
        error "Install git manually, then re-run this script."
        exit 1
    fi
fi
success "Git found: $(command -v git)"

# Check curl or wget
if command -v curl >/dev/null 2>&1; then
    FETCH_CMD="curl -sL"
elif command -v wget >/dev/null 2>&1; then
    FETCH_CMD="wget -qO-"
else
    error "Neither curl nor wget found. Install one of them."
    exit 1
fi
success "Fetch tool: $FETCH_CMD"

# 2. Choose install location
header "Installation location"

# Only prompt if INSTALL_DIR is the default (not explicitly passed)
if [ "$INSTALL_DIR" = "$HOME/glitch-ai" ]; then
    echo ""
    echo "  [1] Current directory: $(pwd)"
    echo "  [2] User home directory: $HOME/glitch-ai (default)"
    echo "  [3] Custom path"
    echo ""
    prompt "  Choose (Enter=2): "
    read -r loc_choice
    case "$loc_choice" in
        1) INSTALL_DIR="$(pwd)" ;;
        3)
            prompt "  Enter installation path: "
            read -r custom_dir
            if [ -n "$custom_dir" ]; then
                INSTALL_DIR="$custom_dir"
            fi
            ;;
    esac
fi
success "Installation directory: $INSTALL_DIR"

# 3. Check install directory
header "Installation directory: $INSTALL_DIR"

if [ -d "$INSTALL_DIR/.git" ]; then
    # Existing git repo — offer update
    warn "Glitch AI already installed at $INSTALL_DIR"
    prompt "Update to latest version? (Y/n): "
    read -r update
    if [ -z "$update" ] || [[ "$update" =~ ^[Yy] ]]; then
        step "Pulling latest changes..."
        (cd "$INSTALL_DIR" && git pull --ff-only)
        if [ $? -eq 0 ]; then
            success "Updated to latest version"
        else
            error "Update failed. You may have local changes."
            warn "Try: cd $INSTALL_DIR && git status"
            exit 1
        fi
    else
        warn "Skipping update. Using existing installation."
    fi
elif [ -d "$INSTALL_DIR" ]; then
    # Directory exists but not a git repo — ask what to do
    warn "Directory '$INSTALL_DIR' already exists (not a git repo)."
    echo ""
    echo "  [1] Overwrite (delete and re-clone)"
    echo "  [2] Choose a different directory"
    echo "  [3] Cancel"
    echo ""
    prompt "  Choose (Enter=3): "
    read -r over_choice
    case "$over_choice" in
        1)
            step "Removing existing directory..."
            rm -rf "$INSTALL_DIR"
            success "Directory cleared."
            ;;
        2)
            prompt "  Enter new installation path: "
            read -r new_dir
            if [ -n "$new_dir" ]; then
                INSTALL_DIR="$new_dir"
                success "Will install to: $INSTALL_DIR"
            else
                warn "Installation cancelled."
                exit 0
            fi
            ;;
        *)
            warn "Installation cancelled."
            exit 0
            ;;
    esac
fi

# Fresh clone (if not a git repo already)
if [ ! -d "$INSTALL_DIR/.git" ]; then
    parent_dir="$(dirname "$INSTALL_DIR")"
    mkdir -p "$parent_dir" 2>/dev/null || true
    
    step "Cloning Glitch AI repository..."
    if git clone --recursive https://github.com/Cothek/glitch-ai.git "$INSTALL_DIR"; then
        success "Repository cloned to $INSTALL_DIR"
    else
        error "Clone failed"
        exit 1
    fi
fi

# 4. Run bootstrap (if exists - it's Windows-specific but launch scripts handle deps)
header "Checking for bootstrap script..."
BOOTSTRAP_PATH="$INSTALL_DIR/scripts/bootstrap.ps1"
if [ -f "$BOOTSTRAP_PATH" ]; then
    warn "bootstrap.ps1 is Windows-specific (PowerShell)."
    warn "On macOS/Linux, dependencies are handled by the launch scripts automatically."
else
    step "No bootstrap needed - launch scripts handle Node.js/OpenCode download."
fi

# 5. User profile setup
header "User Profile Setup"
cat <<'EOF'
Glitch AI stores your personal memory, preferences, and projects in a separate Git repo.
This lets you sync your AI companion across machines via GitHub.
EOF
prompt "Set up user profile from GitHub? (Y/n): "
read -r setup_profile
if [ -z "$setup_profile" ] || [[ "$setup_profile" =~ ^[Yy] ]]; then
    prompt "GitHub username (your GitHub handle): "
    read -r gh_user
    if [ -n "$gh_user" ]; then
        prompt "Repository name (default: glitch-user-$gh_user): "
        read -r repo_name
        [ -z "$repo_name" ] && repo_name="glitch-user-$gh_user"
        
        USER_DIR="$INSTALL_DIR/user"
        if [ -d "$USER_DIR/.git" ]; then
            warn "User profile already exists at $USER_DIR"
        else
            step "Initializing user profile..."
            cd "$USER_DIR"
            git init >/dev/null
            git remote add origin "https://github.com/$gh_user/$repo_name.git" 2>/dev/null
            if git pull origin main --allow-unrelated-histories 2>/dev/null; then
                success "User profile pulled from GitHub"
            else
                warn "No existing profile on GitHub (or pull failed). Starting fresh."
                echo "  Your memory will be saved locally and can be pushed later with: ./scripts/sync-user.ps1 -Push"
            fi
        fi
    fi
fi

# 6. Launch
if [ "$NO_LAUNCH" = false ]; then
    header "Launch Glitch AI"
    prompt "Launch Glitch now? (Y/n): "
    read -r launch
    if [ -z "$launch" ] || [[ "$launch" =~ ^[Yy] ]]; then
        step "Starting Glitch AI..."
        cd "$INSTALL_DIR"
        # Launch in background, detached
        nohup node scripts/launch.mjs > glitch.log 2>&1 &
        PID=$!
        success "Glitch AI launched (PID: $PID)"
        echo ""
        echo "  To launch again later, run:" 
        echo "    cd $INSTALL_DIR"
        echo "    node scripts/launch.mjs"
        echo ""
        echo "  Logs: tail -f $INSTALL_DIR/glitch.log"
    fi
fi

# Completion
header "Installation Complete!"
cat <<EOF
Glitch AI is installed at: $INSTALL_DIR

Next steps:
  • Launch:        cd $INSTALL_DIR && node scripts/launch.mjs
  • Free mode:     cd $INSTALL_DIR && node scripts/launch-free.mjs
  • Local mode:    cd $INSTALL_DIR && node scripts/launch-local.mjs
  • Safe mode:     cd $INSTALL_DIR && node scripts/launch-safe.mjs
  • Update:        Re-run this installer (it will pull latest)
  • User sync:     ./scripts/sync-user.ps1 -Push  (after making changes)

Documentation: https://github.com/Cothek/glitch-ai
EOF