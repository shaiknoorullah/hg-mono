-- Managed by Ansible (deploy/host/roles/logging).
-- Runs on every container log line before VictoriaLogs stores it.

local function redact(s)
  -- Signed links: keep the parameter name, drop the credential or signature.
  s = s:gsub("([?&]X%-Amz%-[%w%-]+=)[^&%s\"']*", "%1REDACTED")
  -- Email addresses.
  s = s:gsub("[%w%.%%%+%-_]+@[%w%-]+%.[%w%.%-]+", "[email]")
  -- Phone numbers: international form (+ and 10 or more digits), and North American
  -- forms such as (416) 555-0199, 416-555-0199 and 416.555.0199.
  s = s:gsub("%+%d%d%d%d%d%d%d%d%d%d+", "[phone]")
  s = s:gsub("%(?%d%d%d%)?[%s%.%-]%d%d%d[%.%-]%d%d%d%d", "[phone]")
  return s
end

function hg_record(tag, timestamp, record)
  local attrs = record["attrs"]
  if type(attrs) == "table" then
    record["project"] = attrs["com.docker.compose.project"] or "none"
    record["service"] = attrs["com.docker.compose.service"] or "none"
    record["attrs"] = nil
  else
    record["project"] = "none"
    record["service"] = "none"
  end
  record["container"] = string.match(tag, "containers%.(%x+)%.") or ""
  if type(record["log"]) == "string" then
    record["log"] = redact(record["log"])
  end
  return 1, timestamp, record
end
