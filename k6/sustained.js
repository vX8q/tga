import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 200,
  duration: "10m",
  thresholds: {
    http_req_failed: ["rate<0.005"],
    http_req_duration: ["p(95)<250"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";

export default function () {
  const endpoints = [
    "/api/series",
    "/api/series/f1",
    "/api/events/f1_2026_1",
    "/api/driver/lewis-hamilton",
    "/api/live-events",
  ];
  const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
  const res = http.get(`${BASE_URL}${endpoint}`);
  check(res, {
    "status is 2xx/404": (r) => (r.status >= 200 && r.status < 300) || r.status === 404,
  });
  sleep(0.2);
}
