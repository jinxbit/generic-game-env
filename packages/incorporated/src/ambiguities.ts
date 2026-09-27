// The defaults RULES.md §13 assumes for every open question, gathered in one
// place so each can be flipped once the question is answered. They are rules,
// not player options: changing one changes how an existing game replays, so
// it ships with a new `rulesVersion` (see ../README.md).

export const AMBIGUITY_DEFAULTS = {
  /** [AMBIG-1] The Growth track has no 0% position. */
  growthTrackHasZero: false,
  /** [AMBIG-2] The Balance of Power end-caps (eagle/dragon) are ±4 and give a ±4 modifier. */
  balanceOfPowerEndCap: 4,
  /** [AMBIG-3] Player counts in which Old Money gets its extra executive. */
  oldMoneyExtraExecutiveAt: [4] as readonly number[],
  /** [AMBIG-4] Outlook cards dealt with THREE_ROUNDS. */
  threeRoundsOutlookCards: 3,
  /** [AMBIG-7] An Outlook flip of a major country never wipes its cubes and shares — only Power Plays do. */
  outlookFlipWipesMajor: false,
  /** [AMBIG-9] Loan proceeds never go below this. (The cap on bonds is TOTAL_BONDS in ./data/board.ts.) */
  minLoanProceeds: 1,
  /** [AMBIG-11] Zone resolution (R-LOB-06) applies in every zone, not only the 3rd World. */
  zoneResolutionEverywhere: true,
  /** [AMBIG-13] A flipped major's bank stock is discarded too, so it can no longer be auctioned. */
  flippedMajorDiscardsBankShares: true,
  /** [AMBIG-14] Central Banks moves its slider exactly this many steps, clamped. */
  centralBanksSteps: 2,
  /** [AMBIG-19] Giant Squid's no-crisis repayment reduction is per bond. */
  giantSquidReductionPerBond: 2,
  /** [AMBIG-22] A private sale's first bid may equal the minimum. */
  privateSaleFirstBidMayEqualMinimum: true,
} as const
