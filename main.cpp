#include <QCoreApplication>
#include <QSettings>
#include "awah-sip_library/awahsiplib.h"

int main(int argc, char *argv[])
{
    QCoreApplication a(argc, argv);

    QSettings settings("awah", "AWAH-Sip_Codec");
    QCoreApplication::setOrganizationName("awah");
    QCoreApplication::setOrganizationDomain("awah.ch");
    QCoreApplication::setApplicationName("AWAH-Sip_Codec");

    AWAHSipLib::prepareLib();
    AWAHSipLib::instance(&a);

    return a.exec();
}
