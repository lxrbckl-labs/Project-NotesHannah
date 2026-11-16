#!/usr/bin/env bash
# Retention ladder for database snapshots. Source after common.sh.
# shellcheck shell=bash

# ladder_victims <dir> <now-epoch>: print the snapshot file names (notes-<stamp>.db) that fall outside the ladder.
#   - everything younger than RETAIN_ALL_HOURS is kept (the 5-minute snapshots)
#   - then the newest snapshot of each hour for RETAIN_HOURLY_HOURS, of each day for RETAIN_DAILY_DAYS,
#     of each ISO week (Monday start) for RETAIN_WEEKLY_WEEKS, of each month for RETAIN_MONTHLY_MONTHS
#   - the newest 3 snapshots are never removed, whatever their age (a stalled clock or a stopped job must not
#     let the ladder eat the last good copies)
ladder_victims() {
  local dir="$1" now="$2"
  find "$dir" -maxdepth 1 -type f -name 'notes-????????T??????Z.db' -exec basename {} \; 2>/dev/null | sort -r | awk \
    -v now="$now" \
    -v all_h="${RETAIN_ALL_HOURS:-2}" -v hourly_h="${RETAIN_HOURLY_HOURS:-48}" \
    -v daily_d="${RETAIN_DAILY_DAYS:-30}" -v weekly_w="${RETAIN_WEEKLY_WEEKS:-26}" \
    -v monthly_m="${RETAIN_MONTHLY_MONTHS:-24}" '
    function days_from(y, m, d,   era, yoe, doy, doe) {
      if (m <= 2) y--
      era = int(y / 400); yoe = y - era * 400
      doy = int((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
      doe = yoe * 365 + int(yoe / 4) - int(yoe / 100) + doy
      return era * 146097 + doe - 719468
    }
    BEGIN {
      # current month index for the monthly tier
      cd = int(now / 86400)
      z = cd + 719468; era = int(z / 146097); doe = z - era * 146097
      yoe = int((doe - int(doe / 1460) + int(doe / 36524) - int(doe / 146096)) / 365)
      y = yoe + era * 400; doy = doe - (365 * yoe + int(yoe / 4) - int(yoe / 100))
      mp = int((5 * doy + 2) / 153); m = mp + (mp < 10 ? 3 : -9); if (m <= 2) y++
      cur_month = y * 12 + m
    }
    {
      name = $0
      y = substr(name, 7, 4) + 0; m = substr(name, 11, 2) + 0; d = substr(name, 13, 2) + 0
      H = substr(name, 16, 2) + 0; M = substr(name, 18, 2) + 0; S = substr(name, 20, 2) + 0
      days = days_from(y, m, d)
      e = days * 86400 + H * 3600 + M * 60 + S
      age = now - e
      n++
      keep = 0
      if (n <= 3) keep = 1
      if (age < all_h * 3600) keep = 1
      hb = int(e / 3600); db = days; wb = int((days + 3) / 7); mb = y * 12 + m
      if (age < hourly_h * 3600 && !(hb in hseen)) { hseen[hb] = 1; keep = 1 }
      if (age < daily_d * 86400 && !(db in dseen)) { dseen[db] = 1; keep = 1 }
      if (age < weekly_w * 7 * 86400 && !(wb in wseen)) { wseen[wb] = 1; keep = 1 }
      if (cur_month - mb < monthly_m && !(mb in mseen)) { mseen[mb] = 1; keep = 1 }
      if (!keep) print name
    }'
}

# prune_ladder <dir>: delete the victims (and their manifests) and stale temp files; prints how many went.
prune_ladder() {
  local dir="$1" victim removed=0
  [ -d "$dir" ] || return 0
  for victim in $(ladder_victims "$dir" "$(now_epoch)"); do
    rm -f "$dir/$victim" "$dir/$victim.json"
    removed=$((removed + 1))
  done
  find "$dir" -maxdepth 1 -name '.tmp-*' -mtime +1 -exec rm -f {} + 2>/dev/null || true
  log "ladder: pruned $removed snapshot(s) in $dir"
}
