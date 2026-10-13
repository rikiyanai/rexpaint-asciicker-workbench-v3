from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from repair_actor_sheets import (  # noqa: E402
    MAGENTA,
    WALLACE_SKIN,
    WALLACE_SWEATER,
    WALLACE_TIE,
    assert_exact_reflections,
    assert_wallace,
    repair_wallace,
)
from xp_core import XPFile  # noqa: E402


def test_wallace_rebuild_uses_player_topology_and_directional_face() -> None:
    wallace, styled, mirrored = repair_wallace()
    player = XPFile(str(ROOT / "sprites" / "player-0000.xp"))

    assert styled > 0
    assert mirrored > 0
    assert_wallace(wallace, player)
    assert_exact_reflections(wallace, 7, 9)

    visual = wallace.layers[2]
    for sprite_row in range(8):
        for sprite_col in range(9):
            origin_x = sprite_col * 7
            origin_y = sprite_row * 9
            assert visual.data[origin_y + 1][origin_x + 2] == (
                222,
                WALLACE_SKIN,
                MAGENTA,
            )
            assert visual.data[origin_y + 1][origin_x + 4] == (
                221,
                WALLACE_SKIN,
                MAGENTA,
            )
            expected_chest = (
                (31, WALLACE_TIE, (255, 255, 255))
                if sprite_row in (0, 1, 2, 6, 7)
                else (32, WALLACE_SWEATER, WALLACE_SWEATER)
            )
            assert visual.data[origin_y + 3][origin_x + 3] == expected_chest
