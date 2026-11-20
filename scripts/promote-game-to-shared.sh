#!/usr/bin/env bash
set -euo pipefail

# Promotes a game downloaded by a player (e.g., player-1) to the shared /srv/games directory
# so that any user/nickname can launch the pre-downloaded game without downloading again.

USER_NICKNAME="${1:-player-1}"
GAME_NAME="${2:-Palworld}"
APP_ID="${3:-1623730}"
SAVES_BASE_DIR="${SAVES_BASE_DIR:-/srv/saves}"
GAMES_BASE_DIR="${GAMES_BASE_DIR:-/srv/games}"

USER_STEAM_APPS="${SAVES_BASE_DIR}/${USER_NICKNAME}/.local/share/Steam/steamapps"
GAME_SRC_DIR="${USER_STEAM_APPS}/common/${GAME_NAME}"
MANIFEST_SRC="${USER_STEAM_APPS}/appmanifest_${APP_ID}.acf"

echo "========================================="
echo " FazCloud: Promote Game to Shared Library"
echo "========================================="
echo "User:        ${USER_NICKNAME}"
echo "Game:        ${GAME_NAME} (App ID: ${APP_ID})"
echo "Source:      ${GAME_SRC_DIR}"
echo "Destination: ${GAMES_BASE_DIR}/${GAME_NAME}"
echo "========================================="

if [[ ! -d "${GAME_SRC_DIR}" ]]; then
  echo "Error: Game source directory not found: ${GAME_SRC_DIR}" >&2
  echo "Make sure ${USER_NICKNAME} has fully downloaded ${GAME_NAME} first." >&2
  exit 1
fi

sudo mkdir -p "${GAMES_BASE_DIR}"

if [[ ! -d "${GAMES_BASE_DIR}/${GAME_NAME}" ]]; then
  echo "Copying game files to shared library (this may take a minute)..."
  sudo cp -r "${GAME_SRC_DIR}" "${GAMES_BASE_DIR}/${GAME_NAME}"
  echo "Copied successfully."
else
  echo "Shared directory ${GAMES_BASE_DIR}/${GAME_NAME} already exists. Updating permissions..."
fi

# Ensure all container users (abc: 1000:1000) can read the game files
sudo chmod -R a+rX "${GAMES_BASE_DIR}/${GAME_NAME}"

# If app manifest exists, copy it into any existing player directories so Steam detects the game as installed
if [[ -f "${MANIFEST_SRC}" ]]; then
  echo "Found manifest: ${MANIFEST_SRC}"
  sudo cp "${MANIFEST_SRC}" "${GAMES_BASE_DIR}/appmanifest_${APP_ID}.acf" 2>/dev/null || true

  for player_dir in "${SAVES_BASE_DIR}"/*; do
    if [[ -d "${player_dir}" && "${player_dir}" != "${SAVES_BASE_DIR}/${USER_NICKNAME}" && "${player_dir}" != "${SAVES_BASE_DIR}/.faz-init" ]]; then
      target_apps="${player_dir}/.local/share/Steam/steamapps"
      if [[ -d "${target_apps}" ]]; then
        echo "Installing manifest for $(basename "${player_dir}")..."
        sudo cp -n "${MANIFEST_SRC}" "${target_apps}/appmanifest_${APP_ID}.acf" 2>/dev/null || true
      fi
    fi
  done
fi

echo "Done! ${GAME_NAME} is now available in ${GAMES_BASE_DIR} for all players."
