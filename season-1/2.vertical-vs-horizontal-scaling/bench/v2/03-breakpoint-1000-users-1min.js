import http from "k6/http";
import { pickUrl, reqParams } from "./pick-live.js";

export const options = {
  scenarios: {
    max_break_test: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "15s", target: 200 }, // 0 se 200
        { duration: "15s", target: 500 }, // 200 se 500
        { duration: "15s", target: 1000 }, // 500 se 1000 - yaha tak tera Mac aaram se jhelega
        { duration: "15s", target: 0 }, // down
      ],
      gracefulRampDown: "0s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.02"], // marks the run failed, does not stop it
  },
};

export function setup() {
  return { url: pickUrl() };
}

export default function (data) {
  http.get(data.url, reqParams);
}
