def add(a: float, b: float) -> float:
    """加和 a、b 为 c"""
    c = a + b
    return c


def normalize(x: float, scale: float) -> float:
    """按 scale 缩放 x"""
    return x / scale


def main(x: float, y: float) -> float:
    """把两个数加和后缩放"""
    s = add(x, y)
    n = normalize(s, 2.0)
    return n
