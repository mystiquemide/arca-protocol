from .database import init_db


def main():
    init_db()
    print("Arca backend migrations applied.")


if __name__ == "__main__":
    main()
