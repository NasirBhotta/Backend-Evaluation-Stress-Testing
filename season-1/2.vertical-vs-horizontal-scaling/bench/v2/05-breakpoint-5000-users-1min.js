// ultra-break.js
import http from "k6/http";
import { pickUrl, reqParams } from "./pick-live.js";
export const options = {
  scenarios: {
    breakpoint: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 3000 },
        { duration: "20s", target: 5000 },
        { duration: "20s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
  },
};
export function setup() {
  return { url: pickUrl() };
}
export default function (data) {
  http.get(data.url, reqParams);
}
