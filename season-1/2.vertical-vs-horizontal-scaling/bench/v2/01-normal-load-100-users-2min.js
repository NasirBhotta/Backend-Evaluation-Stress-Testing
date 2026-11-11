import http from "k6/http";
import { check, sleep } from "k6";
import { pickUrl, reqParams } from "./pick-live.js";

export const options = {
  stages: [
    { duration: "20s", target: 20 }, // 20 sec me 0 se 20 users
    { duration: "30s", target: 20 }, // 30 sec tak 20 users
    { duration: "20s", target: 100 }, // 20 sec me 100 users tak spike
    { duration: "30s", target: 100 }, // 30 sec tak 100 users se maro
    { duration: "20s", target: 0 }, // band karo
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"], // 1% se jyada request fail nahi honi chahiye
    http_req_duration: ["p(95)<500"], // 95% request 500ms ke andar aani chahiye
  },
};

export function setup() {
  return { url: pickUrl() };
}

export default function (data) {
  const res = http.get(data.url, reqParams);

  // check karo ki server crash to nahi hua
  check(res, {
    "status is 200": (r) => r.status === 200,
    "response time < 500ms": (r) => r.timings.duration < 500,
  });

  sleep(1); // 1 sec ruk ke agli request
}
