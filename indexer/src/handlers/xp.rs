//! XP & Levels — cosmetic gamification layered on existing on-chain actions
//! (submit app, suggest tag, vote, stake) plus a once-per-UTC-day bonus. See
//! docs/plans/2026-07-20-gamification-xp-levels-design.md. Never touches
//! vote weight, fees, or ranking — status only.

pub const XP_SUBMIT_APP: i32 = 100;
pub const XP_SUGGEST_TAG: i32 = 40;
pub const XP_VOTE: i32 = 20;
pub const XP_STAKE: i32 = 30;
pub const XP_DAILY_BONUS: i32 = 15;

/// Cumulative XP required to REACH `level` (level 1 = 0 XP). Triangular
/// growth — each additional level costs a constant amount more than the
/// last (100, 200, 300, ...), so early levels come fast and later ones
/// stretch out. See design doc Section 3.
pub fn cumulative_xp_for_level(level: i32) -> i32 {
    50 * (level - 1) * level
}

pub fn level_for_xp(xp: i32) -> i32 {
    let mut level = 1;
    while cumulative_xp_for_level(level + 1) <= xp {
        level += 1;
    }
    level
}

pub fn title_for_level(level: i32) -> &'static str {
    match level {
        1..=4 => "Newcomer",
        5..=9 => "Regular",
        10..=19 => "Contributor",
        20..=29 => "Curator",
        30..=49 => "Tastemaker",
        _ => "Signal",
    }
}

#[cfg(test)]
mod curve_tests {
    use super::*;

    #[test]
    fn level_1_starts_at_zero() {
        assert_eq!(cumulative_xp_for_level(1), 0);
        assert_eq!(level_for_xp(0), 1);
    }

    #[test]
    fn matches_design_doc_table() {
        assert_eq!(cumulative_xp_for_level(2), 100);
        assert_eq!(cumulative_xp_for_level(3), 300);
        assert_eq!(cumulative_xp_for_level(4), 600);
        assert_eq!(cumulative_xp_for_level(5), 1000);
    }

    #[test]
    fn level_for_xp_is_the_floor_of_the_curve() {
        assert_eq!(level_for_xp(99), 1);
        assert_eq!(level_for_xp(100), 2);
        assert_eq!(level_for_xp(299), 2);
        assert_eq!(level_for_xp(300), 3);
    }

    #[test]
    fn titles_match_level_ranges() {
        assert_eq!(title_for_level(1), "Newcomer");
        assert_eq!(title_for_level(4), "Newcomer");
        assert_eq!(title_for_level(5), "Regular");
        assert_eq!(title_for_level(10), "Contributor");
        assert_eq!(title_for_level(20), "Curator");
        assert_eq!(title_for_level(30), "Tastemaker");
        assert_eq!(title_for_level(50), "Signal");
        assert_eq!(title_for_level(1000), "Signal");
    }
}
