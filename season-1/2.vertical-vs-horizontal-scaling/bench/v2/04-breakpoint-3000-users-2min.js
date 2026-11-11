import http from "k6/http";
import { pickUrl, reqParams } from "./pick-live.js";

export const options = {
  scenarios: {
    breakpoint: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 500 },
        { duration: "20s", target: 1000 },
        { duration: "20s", target: 2000 },
        { duration: "30s", target: 3000 }, // yaha tak M1 Pro bhi paseena chodega
        { duration: "20s", target: 0 },
      ],
      gracefulRampDown: "0s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"], // marks the run failed, does not stop it
  },
};

export function setup() {
  return { url: pickUrl() };
}

export default function (data) {
  http.get(data.url, reqParams);
}
