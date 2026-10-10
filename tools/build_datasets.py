"""
Build the sample datasets served from public/datasets/.

Real public datasets are fetched where a stable source exists (Titanic, Iris,
Gapminder); the rest are generated with pandas/numpy using fixed seeds so the
files are byte-for-byte reproducible.

Run with:  python tools/build_datasets.py
"""
from __future__ import annotations

import io
import os
import urllib.request

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "public", "datasets")
os.makedirs(OUT, exist_ok=True)

SOURCES = {
    "titanic": "https://raw.githubusercontent.com/mwaskom/seaborn-data/master/titanic.csv",
    "iris": "https://raw.githubusercontent.com/mwaskom/seaborn-data/master/iris.csv",
    "gapminder": "https://raw.githubusercontent.com/plotly/datasets/master/gapminderDataFiveYear.csv",
}


def fetch(name: str) -> pd.DataFrame | None:
    url = SOURCES[name]
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            raw = r.read().decode("utf-8", errors="replace")
        df = pd.read_csv(io.StringIO(raw))
        print(f"  fetched {name}: {df.shape[0]} x {df.shape[1]}")
        return df
    except Exception as exc:  # noqa: BLE001 - we want any failure to fall back
        print(f"  could not fetch {name} ({exc}); will synthesise instead")
        return None


def write(df: pd.DataFrame, name: str) -> None:
    path = os.path.join(OUT, f"{name}.csv")
    df.to_csv(path, index=False)
    size = os.path.getsize(path)
    print(f"  wrote {name}.csv  {df.shape[0]} rows x {df.shape[1]} cols  {size / 1024:.0f} KB")


# --------------------------------------------------------------------------- #
# Titanic — real data, lightly cleaned so the file is self-describing
# --------------------------------------------------------------------------- #
def build_titanic() -> None:
    df = fetch("titanic")
    if df is None:
        raise SystemExit("titanic is required as the default dataset")
    keep = [
        "survived", "pclass", "sex", "age", "sibsp", "parch",
        "fare", "embarked", "class", "who", "adult_male", "deck",
        "embark_town", "alive", "alone",
    ]
    df = df[[c for c in keep if c in df.columns]].copy()
    df = df.rename(columns={
        "survived": "Survived", "pclass": "Pclass", "sex": "Sex", "age": "Age",
        "sibsp": "SibSp", "parch": "Parch", "fare": "Fare", "embarked": "Embarked",
        "class": "Class", "who": "Who", "adult_male": "AdultMale", "deck": "Deck",
        "embark_town": "EmbarkTown", "alive": "Alive", "alone": "Alone",
    })
    write(df, "titanic")


# --------------------------------------------------------------------------- #
# Iris — real data
# --------------------------------------------------------------------------- #
def build_iris() -> None:
    df = fetch("iris")
    if df is None:
        raise SystemExit("iris is required")
    df = df.rename(columns={
        "sepal_length": "SepalLength", "sepal_width": "SepalWidth",
        "petal_length": "PetalLength", "petal_width": "PetalWidth",
        "species": "Species",
    })
    write(df, "iris")


# --------------------------------------------------------------------------- #
# Gapminder — real data
# --------------------------------------------------------------------------- #
def build_gapminder() -> None:
    df = fetch("gapminder")
    if df is None:
        rng = np.random.default_rng(11)
        rows = []
        countries = [
            ("China", "Asia"), ("India", "Asia"), ("Japan", "Asia"),
            ("United States", "Americas"), ("Brazil", "Americas"),
            ("Germany", "Europe"), ("France", "Europe"), ("Nigeria", "Africa"),
            ("Egypt", "Africa"), ("Australia", "Oceania"),
        ]
        for country, continent in countries:
            base_gdp = rng.uniform(700, 30000)
            base_life = rng.uniform(45, 78)
            for year in range(1952, 2008, 5):
                t = (year - 1952) / 56
                rows.append({
                    "country": country,
                    "continent": continent,
                    "year": year,
                    "lifeExp": round(base_life + 12 * t + rng.normal(0, 0.7), 3),
                    "pop": int(rng.uniform(4e6, 1.3e9) * (1 + 0.9 * t)),
                    "gdpPercap": round(base_gdp * (1 + 2.4 * t) * rng.uniform(0.9, 1.1), 3),
                })
        df = pd.DataFrame(rows)
    df = df.rename(columns={
        "country": "Country", "continent": "Continent", "year": "Year",
        "lifeExp": "LifeExpectancy", "pop": "Population", "gdpPercap": "GDPPerCapita",
    })
    write(df, "gapminder")


# --------------------------------------------------------------------------- #
# E-commerce orders — synthetic, dated, business-shaped
# --------------------------------------------------------------------------- #
def build_sales() -> None:
    rng = np.random.default_rng(20261009)
    n = 5000

    regions = ["North", "South", "East", "West", "Central"]
    categories = ["Electronics", "Apparel", "Home", "Grocery", "Sports", "Beauty"]
    channels = ["Web", "Mobile", "Store", "Partner"]
    segments = ["Consumer", "Corporate", "Home Office"]
    payments = ["Card", "Wallet", "Transfer", "Cash"]

    # Deliberately uneven category weights so group-by results have a story.
    cat_p = [0.28, 0.22, 0.18, 0.15, 0.10, 0.07]
    region_p = [0.30, 0.18, 0.24, 0.20, 0.08]

    start = pd.Timestamp("2023-01-01")
    # Weekly seasonality + an upward trend + a Q4 bump, so the time-series view
    # has something real to find.
    day_offsets = rng.integers(0, 730, size=n)
    dates = start + pd.to_timedelta(day_offsets, unit="D")

    category = rng.choice(categories, size=n, p=cat_p)
    region = rng.choice(regions, size=n, p=region_p)
    channel = rng.choice(channels, size=n, p=[0.42, 0.33, 0.17, 0.08])
    segment = rng.choice(segments, size=n, p=[0.55, 0.3, 0.15])
    payment = rng.choice(payments, size=n, p=[0.5, 0.24, 0.18, 0.08])

    unit_price = np.round(
        np.select(
            [category == "Electronics", category == "Apparel", category == "Home",
             category == "Grocery", category == "Sports", category == "Beauty"],
            [rng.normal(420, 190, n), rng.normal(85, 40, n), rng.normal(160, 90, n),
             rng.normal(35, 18, n), rng.normal(95, 55, n), rng.normal(60, 30, n)],
        ).clip(3, None), 2,
    )
    quantity = rng.integers(1, 9, size=n)
    discount = np.round(np.where(rng.random(n) < 0.34, rng.uniform(0.05, 0.4, n), 0.0), 3)
    revenue = np.round(unit_price * quantity * (1 - discount), 2)
    cost = np.round(revenue * rng.uniform(0.42, 0.78, n), 2)
    profit = np.round(revenue - cost, 2)
    rating = np.round(np.clip(rng.normal(4.1, 0.8, n), 1, 5), 1)
    delivery_days = np.clip(np.round(rng.normal(4.5, 2.6, n)), 1, 30).astype(int)
    returned = rng.random(n) < 0.08
    customer_age = np.clip(np.round(rng.normal(37, 12, n)), 18, 79).astype(int)

    df = pd.DataFrame({
        "OrderID": [f"ORD-{100000 + i}" for i in range(n)],
        "OrderDate": dates.strftime("%Y-%m-%d"),
        "Region": region,
        "Category": category,
        "Channel": channel,
        "Segment": segment,
        "PaymentMethod": payment,
        "UnitPrice": unit_price,
        "Quantity": quantity,
        "Discount": discount,
        "Revenue": revenue,
        "Cost": cost,
        "Profit": profit,
        "CustomerAge": customer_age,
        "Rating": rating,
        "DeliveryDays": delivery_days,
        "Returned": np.where(returned, "True", "False"),
    })
    df = df.sort_values("OrderDate", kind="stable").reset_index(drop=True)
    write(df, "sales")


# --------------------------------------------------------------------------- #
# Air quality — synthetic, deliberately dirty
# --------------------------------------------------------------------------- #
def build_airquality() -> None:
    rng = np.random.default_rng(777)
    n = 1461  # four years of daily readings
    dates = pd.date_range("2022-01-01", periods=n, freq="D")

    t = np.arange(n)
    # Seasonal cycle (annual) + weekly cycle + slow drift + noise.
    seasonal = 12 * np.sin(2 * np.pi * t / 365.25 - 1.1)
    weekly = -2.5 * (dates.dayofweek >= 5)
    drift = 0.0022 * t
    pm25 = np.clip(38 + seasonal + weekly + drift + rng.normal(0, 9, n), 2, None)
    pm10 = np.clip(pm25 * rng.uniform(1.3, 2.0, n) + rng.normal(0, 7, n), 3, None)
    no2 = np.clip(21 + seasonal * 0.5 + rng.normal(0, 6, n), 1, None)
    o3 = np.clip(58 - seasonal * 1.4 + rng.normal(0, 12, n), 2, None)
    so2 = np.clip(7 + rng.normal(0, 3, n), 0.2, None)
    temp = np.round(14 + 11 * np.sin(2 * np.pi * t / 365.25 - 1.6) + rng.normal(0, 2.6, n), 1)
    humidity = np.clip(62 - 14 * np.sin(2 * np.pi * t / 365.25 - 1.6) + rng.normal(0, 11, n), 12, 100)
    wind = np.clip(rng.gamma(2.2, 1.5, n), 0.1, None)

    df = pd.DataFrame({
        "Date": dates.strftime("%Y-%m-%d"),
        "Station": rng.choice(["North-Yard", "Riverside", "Downtown", "Industrial-Park"],
                              size=n, p=[0.3, 0.25, 0.28, 0.17]),
        "PM25": np.round(pm25, 2),
        "PM10": np.round(pm10, 2),
        "NO2": np.round(no2, 2),
        "O3": np.round(o3, 2),
        "SO2": np.round(so2, 2),
        "Temperature": temp,
        "Humidity": np.round(humidity, 1),
        "WindSpeed": np.round(wind, 2),
    })

    # A few genuine spikes so outlier detection has something to find.
    spike_idx = rng.choice(n, size=9, replace=False)
    df.loc[spike_idx, "PM25"] = np.round(rng.uniform(280, 620, 9), 2)

    # Holes: a sensor outage (a contiguous block) plus scattered dropouts, and a
    # fully dead column to exercise the "drop this column" recommendation.
    df.loc[120:146, "PM10"] = np.nan
    df.loc[520:559, "NO2"] = np.nan
    for col, rate in [("PM25", 0.06), ("PM10", 0.04), ("NO2", 0.11), ("O3", 0.07), ("SO2", 0.19), ("WindSpeed", 0.03)]:
        mask = rng.random(n) < rate
        df.loc[mask, col] = np.nan
    df["Calibration"] = np.nan

    write(df, "airquality")


# --------------------------------------------------------------------------- #
# Large order table — for the performance story
# --------------------------------------------------------------------------- #
def build_bigsales() -> None:
    rng = np.random.default_rng(31337)
    n = 100_000
    dates = pd.Timestamp("2022-01-01") + pd.to_timedelta(rng.integers(0, 1095, n), unit="D")
    category = rng.choice(
        ["Electronics", "Apparel", "Home", "Grocery", "Sports", "Beauty", "Toys", "Auto"],
        size=n, p=[0.2, 0.16, 0.14, 0.13, 0.11, 0.09, 0.09, 0.08],
    )
    unit_price = np.round(rng.lognormal(4.2, 0.85, n), 2)
    quantity = rng.integers(1, 13, size=n)
    revenue = np.round(unit_price * quantity, 2)
    df = pd.DataFrame({
        "OrderID": np.arange(1, n + 1),
        "OrderDate": dates.strftime("%Y-%m-%d"),
        "Country": rng.choice(
            ["China", "United States", "Germany", "Japan", "Brazil", "India", "United Kingdom", "France"],
            size=n, p=[0.3, 0.2, 0.11, 0.1, 0.08, 0.08, 0.07, 0.06],
        ),
        "Category": category,
        "Channel": rng.choice(["Web", "Mobile", "Store", "Partner"], size=n, p=[0.4, 0.34, 0.18, 0.08]),
        "UnitPrice": unit_price,
        "Quantity": quantity,
        "Revenue": revenue,
        "Profit": np.round(revenue * rng.uniform(0.05, 0.45, n), 2),
        "CustomerAge": np.clip(np.round(rng.normal(38, 13, n)), 18, 82).astype(int),
        "Rating": np.round(np.clip(rng.normal(4.0, 0.9, n), 1, 5), 1),
    })
    df = df.sort_values("OrderDate", kind="stable").reset_index(drop=True)
    write(df, "bigsales")


def main() -> None:
    print("building sample datasets ->", OUT)
    build_titanic()
    build_iris()
    build_gapminder()
    build_sales()
    build_airquality()
    build_bigsales()
    print("done")


if __name__ == "__main__":
    main()
