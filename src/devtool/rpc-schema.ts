import type { StandardSchemaV1 } from "devframe/utils/simple-schema";

export function objectResult<T extends object>(): StandardSchemaV1<T> {
  return {
    "~standard": {
      version: 1,
      vendor: "compulsive",
      validate(value) {
        return typeof value === "object" && value !== null && !Array.isArray(value)
          ? { value: value as T }
          : { issues: [{ message: "Expected an object" }] };
      },
    },
  };
}
