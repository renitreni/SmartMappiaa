import { useEffect, useState } from "react";
import { api } from "../portal/lib/api";
import { liveRestaurantPath } from "./restaurantLinks";

export function useLiveRestaurantRoute(partnerName) {
  const [path, setPath] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!partnerName) {
      setPath(null);
      setLoading(false);
      return undefined;
    }

    let alive = true;

    api
      .foodRestaurants()
      .then((data) => {
        if (!alive) return;
        setPath(liveRestaurantPath(partnerName, data?.restaurants || []));
      })
      .catch(() => {
        if (!alive) return;
        setPath(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [partnerName]);

  return { path, loading };
}
