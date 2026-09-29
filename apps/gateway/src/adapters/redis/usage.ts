import { Schema } from 'effect';

// These keys hold only the current minute and expire after idle periods. Redis TIME
// aligns replicas. Protect telemetry writes: failures must never undo admission or
// send an already-debited reservation through the local fallback.
export const accountUsage = `
local minute = math.floor(now / 60000) * 60
local ok = pcall(function()
  if tonumber(redis.call('HGET', 'graphql:quota:usage', 'minute')) ~= minute then
    redis.call('DEL', 'graphql:quota:usage:ips')
    redis.call('HSET', 'graphql:quota:usage', 'minute', minute, 'points', 0)
  end
  redis.call('HINCRBYFLOAT', 'graphql:quota:usage', 'points', cost)
  redis.call('PFADD', 'graphql:quota:usage:ips', ARGV[4])
  redis.call('EXPIRE', 'graphql:quota:usage', 120)
  redis.call('EXPIRE', 'graphql:quota:usage:ips', 120)
end)
if not ok then
  redis.pcall('SET', 'graphql:quota:usage:invalid', minute, 'EX', 120)
end
`;

export const readUsage = `
local clock = redis.call('TIME')
local sampled = tonumber(clock[1]) + tonumber(clock[2]) / 1000000
local minute = math.floor(sampled / 60) * 60
if tonumber(redis.call('GET', 'graphql:quota:usage:invalid')) == minute then
  return {-1, tostring(sampled), 0, 0}
end
local state = redis.call('HMGET', 'graphql:quota:usage', 'minute', 'points')
if tonumber(state[1]) ~= minute then return {minute, tostring(sampled), 0, 0} end
return {minute, tostring(sampled), state[2], redis.call('PFCOUNT', 'graphql:quota:usage:ips')}
`;

export const decodeUsage = Schema.decodeUnknownEffect(
  Schema.Tuple([
    Schema.Int,
    Schema.NumberFromString,
    Schema.Union([Schema.Number, Schema.NumberFromString]),
    Schema.Int,
  ]),
  { reportInput: false }
);
