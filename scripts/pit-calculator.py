#!/usr/bin/env python3
"""
MEME GP — Weekly PIT Calculator
================================
Run this every Thursday morning after collecting tweet engagement data.

INPUT  (stdin or CSV file):
  Pieter pulls engagement from each team's @MemeGrandPrix tweet posted Tuesday.
  CSV columns: ticker, followers, likes, reposts, replies
  
USAGE:
  # Edit data/pit-input-YYYY-MM-DD.csv with this week's numbers, then:
  python3 scripts/pit-calculator.py data/pit-input-2026-05-26.csv
  
  # Output goes to stdout AND data/pit-scores.json
  # Commit data/pit-scores.json to trigger a Vercel rebuild

FORMULA (locked May 17 2026):
  weighted = likes×1 + reposts×3 + replies×2
  rate     = (weighted / followers) × 100
  brackets:
    0–0.5%   → 1.0
    0.5–2%   → 3.0
    2–5%     → 5.0
    5–10%    → 7.0
    10–20%   → 8.5
    20%+     → 9.5
"""
import sys
import csv
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Anti-gaming flag: if a team's score looks suspicious, manually override
# by passing --override TICKER=SCORE on the command line. Reasons logged to stderr.

def calc_pit(likes, reposts, replies, followers):
    """Apply the locked PIT formula."""
    if followers <= 0:
        return 1.0, 0.0
    weighted = likes * 1 + reposts * 3 + replies * 2
    rate = (weighted / followers) * 100
    
    if rate < 0.5:      score = 1.0
    elif rate < 2:      score = 3.0
    elif rate < 5:      score = 5.0
    elif rate < 10:     score = 7.0
    elif rate < 20:     score = 8.5
    else:               score = 9.5
    
    return score, rate


def parse_overrides(args):
    """Parse --override TICKER=SCORE from CLI args."""
    overrides = {}
    for a in args:
        if a.startswith('--override='):
            spec = a.split('=', 1)[1]
            tkr, val = spec.split('=', 1)
            overrides[tkr.strip()] = float(val.strip())
    return overrides


def next_cycle_close():
    """Next Thursday 09:00 SAST (UTC+2)."""
    sast = timezone(timedelta(hours=2))
    now = datetime.now(sast)
    # weekday: Mon=0, Thu=3
    days_ahead = (3 - now.weekday()) % 7
    if days_ahead == 0 and now.hour >= 9:
        days_ahead = 7
    next_thu = (now + timedelta(days=days_ahead)).replace(hour=9, minute=0, second=0, microsecond=0)
    return next_thu.astimezone(timezone.utc).isoformat()


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    
    csv_path = sys.argv[1]
    overrides = parse_overrides(sys.argv[2:])
    
    rows = []
    with open(csv_path) as f:
        reader = csv.DictReader(f)
        for r in reader:
            # Strip whitespace, normalise
            row = {k.strip(): v.strip() for k, v in r.items()}
            rows.append(row)
    
    if not rows:
        print(f"ERROR: no rows in {csv_path}", file=sys.stderr)
        sys.exit(1)
    
    print(f"\n🏁 PIT CALCULATOR — {datetime.now().strftime('%Y-%m-%d %H:%M')}", file=sys.stderr)
    print(f"   Input: {csv_path}   |   {len(rows)} teams", file=sys.stderr)
    if overrides:
        print(f"   Overrides: {overrides}", file=sys.stderr)
    print(f"   {'─' * 78}", file=sys.stderr)
    print(f"   {'Team':<12} {'Followers':>10} {'Likes':>7} {'RTs':>5} {'Reps':>5} {'Weighted':>9} {'Rate%':>7} {'PIT':>5}", file=sys.stderr)
    print(f"   {'─' * 78}", file=sys.stderr)
    
    scores = {}
    for row in rows:
        tkr = row['ticker']
        likes = int(row.get('likes', 0) or 0)
        reposts = int(row.get('reposts', 0) or 0)
        replies = int(row.get('replies', 0) or 0)
        followers = int(row.get('followers', 0) or 0)
        
        score, rate = calc_pit(likes, reposts, replies, followers)
        weighted = likes * 1 + reposts * 3 + replies * 2
        
        flag = ''
        if tkr in overrides:
            flag = f' ← OVERRIDE (was {score})'
            score = overrides[tkr]
        
        scores[tkr] = score
        print(f"   {tkr:<12} {followers:>10,} {likes:>7,} {reposts:>5,} {replies:>5,} {weighted:>9,} {rate:>6.2f}% {score:>5.1f}{flag}", file=sys.stderr)
    
    print(f"   {'─' * 78}", file=sys.stderr)
    
    # Build output JSON
    cycle_date = Path(csv_path).stem.replace('pit-input-', '')
    output = {
        '_comment': 'PIT scores from weekly X engagement cycle. See data/history.json for raw input.',
        'last_updated': datetime.now(timezone.utc).strftime('%Y-%m-%d'),
        'cycle_id': cycle_date,
        'next_cycle_close': next_cycle_close(),
        'scores': scores,
    }
    
    # Write to data/pit-scores.json
    output_path = Path('data/pit-scores.json')
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(output, f, indent=2)
        f.write('\n')
    
    print(f"\n   ✓ Written to {output_path}", file=sys.stderr)
    print(f"   ✓ Next cycle closes: {output['next_cycle_close']}", file=sys.stderr)
    print(f"\n   Commit and push to deploy:", file=sys.stderr)
    print(f"      git add data/pit-scores.json", file=sys.stderr)
    print(f"      git commit -m 'pit: cycle {cycle_date}'", file=sys.stderr)
    print(f"      git push\n", file=sys.stderr)
    
    # Also print JSON to stdout for piping
    print(json.dumps(output, indent=2))


if __name__ == '__main__':
    main()
