import http from "k6/http";
import { pickUrl, reqParams } from "./pick-live.js";

export const options = {
  scenarios: {
    monster: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 45000 }, // warmup
        { duration: "20s", target: 75000 },
        { duration: "20s", target: 112500 },
        { duration: "20s", target: 150000 }, // yaha pe tootega
        { duration: "10s", target: 0 },
      ],
      gracefulRampDown: "0s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<1000"], // marks the run failed, does not stop it
  },
};

export function setup() {
  return { url: pickUrl() };
}

export default function (data) {
  http.get(data.url, reqParams);
}
