export function deserializeBidiRemoteValue(remoteValue: any): any {
  if (!remoteValue || typeof remoteValue !== "object") return remoteValue;
  switch (remoteValue.type) {
    case "string":
    case "number":
    case "boolean":
      return remoteValue.value;
    case "null":
      return null;
    case "undefined":
      return undefined;
    case "array":
      return (remoteValue.value || []).map((item: any) => deserializeBidiRemoteValue(item));
    case "object":
      const obj: Record<string, any> = {};
      for (const [key, val] of remoteValue.value || []) {
        obj[key] = deserializeBidiRemoteValue(val);
      }
      return obj;
    default:
      return remoteValue.value ?? remoteValue;
  }
}
