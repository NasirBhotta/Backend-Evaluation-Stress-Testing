// stress-test.js
import http from "k6/http";
import { pickUrl, reqParams } from "./pick-live.js";
export const options = {
  stages: [
    { duration: "1m", target: 200 },
    { duration: "1m", target: 400 },
    { duration: "1m", target: 600 },
    { duration: "20s", target: 0 },
  ],
};
export function setup() {
  return { url: pickUrl() };
}
export default function (data) {
  http.get(data.url, reqParams);
}
