/**
 * Monetization hooks, deliberately thin. Every call site in the game goes
 * through this object, so swapping the stub for a real ad SDK or IAP backend is
 * a single-file change and nothing in gameplay needs to know.
 *
 * Nothing here gates playability: rewards are bonuses, never requirements.
 */
export class Monetization {
  constructor(events) {
    this.events = events;
    this.provider = null;          // set by a real integration later
    this.interstitialEvery = 3;    // level completions between interstitials
    this._sinceInterstitial = 0;
    this.revivesUsedThisRun = 0;
    this.maxRevivesPerRun = 1;
  }

  /** @returns {Promise<boolean>} resolved true when the reward should be granted. */
  showRewarded(placement) {
    if (this.provider?.showRewarded) return this.provider.showRewarded(placement);
    // Stub: resolves immediately so the prototype loop is fully playable.
    return new Promise((res) => setTimeout(() => res(true), 650));
  }

  showInterstitial(placement) {
    if (this.provider?.showInterstitial) return this.provider.showInterstitial(placement);
    return Promise.resolve(true);
  }

  canRevive() { return this.revivesUsedThisRun < this.maxRevivesPerRun; }
  useRevive() { this.revivesUsedThisRun++; }
  resetRun() { this.revivesUsedThisRun = 0; }

  /** Interstitials only ever fire between levels, never during combat. */
  maybeInterstitial() {
    this._sinceInterstitial++;
    if (this._sinceInterstitial >= this.interstitialEvery) {
      this._sinceInterstitial = 0;
      return this.showInterstitial('level_transition');
    }
    return Promise.resolve(false);
  }
}
