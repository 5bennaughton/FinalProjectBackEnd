

export function formatStravaSession(activity: any) {
  return {
    id: activity.id,
    sport: activity.sport_type,
    title: activity.name,

    distanceKm: (activity.distance / 1000).toFixed(2),
    movingTimeMin: Math.round(activity.moving_time / 60),
    avgSpeedKmh: (activity.average_speed * 3.6).toFixed(1),
    maxSpeedKmh: (activity.max_speed * 3.6).toFixed(1),

    startDate: activity.start_date_local,
    location: activity.location_city ?? "Unknown",

    mapPolyline: activity.map?.summary_polyline ?? null,
  };
}
