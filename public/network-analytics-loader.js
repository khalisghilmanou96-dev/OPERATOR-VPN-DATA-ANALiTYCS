window.addEventListener("DOMContentLoaded", async () => {
  if (sessionStorage.getItem("networkAnalyticsChecked")) {
    return;
  }

  try {
    const response = await fetch("/network-analytics/checkin", {
      method: "POST",
      credentials: "same-origin"
    });

    if (response.ok) {
      sessionStorage.setItem("networkAnalyticsChecked", "1");
    }
  } catch (error) {
    console.error("Network analytics indisponible :", error);
  }
});
