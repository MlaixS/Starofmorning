let check;
if (encid == "nightmarecreep3") {
        switch (enemy) {
            case "Doubt":
                check = "560";
                break;
            case "Pride":
                check = "561";
                break;
            case "Justice":
                check = "562";
                break;
            default:
                check = "563";
        }
}else
    switch (enemy) {
        case "Toydier":
            check = "676";
            break;
        case "Heavy":
            check = "677";
            break;
        case "MELTER":
            if (arg1 == 0) {
                check = "567";
            }else{
                check = "564";
            }
            break;
        case "Maneater":
            if (arg1 == "Genocide") {
                check = "/f565";
            }else{
                check = "566";
            }
            break;
        case "Dummy":
            check = "691";
            break;
        case "buckthorn":
            check = "687";
            break;
        case "Loox":
            check = "686";
            break;
        case "IT":
            check = "1320";
            break;
        case "Moldsmalini":
            check = "685";
            break;
        case "Loox Noir":
            check = "684";
            break;
        case "Vegetoid":
            check = "682";
            break;
        case "Moldsmal":
            check = "681";
            break;
        case "Froggit":
            check = "678";
            break;
        case "Doge":
            check = "695";
            break;
        case "MKid":
            check = "696";
            break;
        case "Migosp":
            if (arg1 == 1) {
                check = "679";
            }else{
                check = "680";
            }
            break;
        case "Whimsun":
            if (arg2 > 1) {
                if (arg1 == 1) {
                    check = "688";
                }else{
                    check = "689";
            }
            }else{
                check = "690";
            }
            break;
        case "Papyrus":
            if (encid == "Papyrus") {
                if (arg1 == "Spareable") {
                    check = "692";
                }else{
                    check = "693";
            }
            }else{
                check = "694";
            }
            break;
        case "Froge":
            check = "683";
            break;
        case "Tank":
            check = "687";
            break;
        default:
            check = "* No defined check, have a@  placeholder instead.";

    }