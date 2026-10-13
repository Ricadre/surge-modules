# Historical research only. Not included in published module 0.1.1.
# Filter only timeline instruction collections. Never scan tweet text or quotes.
def is_ad:
  if type != "object" then false
  else
    ((.entryId // .entry_id // "") |
      if type == "string" then startswith("promoted-") or startswith("promoted_") else false end)
    or any(
      [., .content?, .content?.itemContent?, .item?, .item?.itemContent?, .itemContent?,
       .content?.item?, .content?.item?.content?, .content?.item?.content?.tweet?,
       .content?.item?.content?.user?, .item?.content?, .item?.content?.tweet?,
       .item?.content?.user?][] | objects;
      (.promotedMetadata? != null and .promotedMetadata? != false)
      or (.promoted_metadata? != null and .promoted_metadata? != false)
    )
  end;

def clean_entry:
  if type == "object" and (.content?.items? | type) == "array" then
    (.content.items | length) as $before |
    .content.items |= map(select(is_ad | not)) |
    if $before > 0 and (.content.items | length) == 0 then empty else . end
  else . end;

def clean_entries: map(select(is_ad | not) | clean_entry);

def clean_instruction:
  if type != "object" then . else
    (if (.entries? | type) == "array" then .entries |= clean_entries else . end) |
    (if (.moduleItems? | type) == "array" then .moduleItems |= map(select(is_ad | not)) else . end) |
    (if (.entry? | type) == "object" then
       (.entry | select(is_ad | not) | clean_entry) as $entry | .entry = $entry
     else . end) |
    (if (.addEntries?.entries? | type) == "array" then .addEntries.entries |= clean_entries else . end) |
    (if (.replaceEntry?.entry? | type) == "object" then
       (.replaceEntry.entry | select(is_ad | not) | clean_entry) as $entry | .replaceEntry.entry = $entry
     else . end)
  end;

walk(if type == "object" and (.instructions? | type) == "array"
     then .instructions |= map(clean_instruction) else . end)
